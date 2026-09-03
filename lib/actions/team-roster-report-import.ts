'use server';

// lib/actions/team-roster-report-import.ts
//
// Accepts the "Team Roster Report" .xlsx export directly (the format the
// league already gets from its registration platform: one sheet, a
// Program Name / Division Name header, then a repeating block per team —
// a "Team Players" sub-table followed by a "Team Personnel" sub-table) so
// rosters and coaches can be uploaded without reformatting into the
// generic CSV templates in coach-import.ts / roster-import.ts.
//
// This is a thin adapter, not a third import path: it parses the sheet
// into the same CoachImportRow[] / RosterImportRow[] shapes those two
// files already expect, then calls bulkImportCoaches / bulkImportRoster
// to do the actual person-resolution and writes. All of the real
// behavior (placeholder people, dedupe, org membership, the
// submitted_by_person_id guardian link) lives there — see those files'
// header comments.
//
// Two things specific to this export format, worth calling out:
//
// - "Team Players" rows carry an "Account First/Last Name / Email / Cell
//   Phone" — that's the parent/guardian who registered the player, NOT
//   the player's own contact info (this report never gives the player's
//   own email). So RosterImportRow.email is left blank here and the
//   Account columns are passed through as guardian* fields instead —
//   see roster-import.ts's header comment for why that distinction
//   matters (misattributing a parent's email to the child's own person
//   record would be wrong, not just imprecise).
//
// - "Team Personnel" rows carry a free-text "Volunteer Role" — this
//   report's exports have been observed using "Team Manager", "Assistant
//   Coach", "Score Keeper", and "Team Parent". Team Manager is treated as
//   the team's head coach and Assistant Coach maps directly; everything
//   else (Score Keeper, Team Parent, anything unrecognized) is imported
//   as a generic volunteer, since leago's team_staff role only
//   distinguishes head_coach / assistant_coach / volunteer. This mapping
//   is a reasonable-default guess, not a confirmed spec — worth checking
//   against how the roles actually get used before relying on the
//   head/assistant distinction anywhere.

import ExcelJS from 'exceljs';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';
import { bulkImportCoaches, type CoachImportRow, type CoachRole } from './coach-import';
import { bulkImportRoster, type RosterImportRow } from './roster-import';

function normalizeVolunteerRole(raw: string): CoachRole {
  const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (key === 'assistantcoach' || key === 'assistant') return 'assistant_coach';
  if (key === 'teammanager' || key === 'headcoach' || key === 'coach') return 'head_coach';
  return 'volunteer'; // "Score Keeper", "Team Parent", anything else unrecognized
}

// exceljs cell.value can be a plain string/number, null, or (for a rich
// text run or a formula result) a small object — normalize all of those
// down to a trimmed string so the row-walking logic below doesn't need
// to care which shape a given cell came in as.
function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('richText' in (v as any)) return (v as any).richText.map((r: any) => r.text).join('').trim();
    if ('result' in (v as any)) return String((v as any).result ?? '').trim();
    if ('text' in (v as any)) return String((v as any).text).trim();
    return '';
  }
  return String(v).trim();
}

type ImportTeamRosterReportResult =
  | {
      teamsFound: number;
      unmatchedTeamNames: string[];
      coachResult: { staffed: number; skipped: number; peopleCreated: number };
      rosterResult: { registered: number; skipped: number; peopleCreated: number };
    }
  | { error: string };

export async function importTeamRosterReport(
  organizationId: string,
  divisionId: string,
  formData: FormData
): Promise<ImportTeamRosterReportResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_divisions');
    if (!authorized) {
      return { error: 'You do not have permission to import a roster.' };
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return { error: 'No file uploaded.' };
    }

    const admin = createAdminClient();

    // Defense in depth — same pattern as coach-import.ts / roster-import.ts.
    const { data: division } = await admin
      .from('divisions')
      .select('id, seasons ( organization_id )')
      .eq('id', divisionId)
      .single();
    const orgId = (division?.seasons as any)?.organization_id;
    if (!division || orgId !== organizationId) {
      return { error: 'Division not found for this organization.' };
    }

    const { data: divisionTeams } = await admin.from('teams').select('id, name').eq('division_id', divisionId);
    const teamIdByName = new Map((divisionTeams ?? []).map((t) => [t.name.trim().toLowerCase(), t.id]));

    let workbook: ExcelJS.Workbook;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      workbook = new ExcelJS.Workbook();
      // exceljs's own .d.ts declares a fallback global `Buffer extends
      // ArrayBuffer` (for consumers without @types/node) that merges with
      // @types/node's real Buffer and produces a type TS can't reconcile
      // with what Buffer.from() actually returns — a real Node Buffer at
      // runtime, so `any` here is just working around a broken type
      // declaration, not a real type-safety gap.
      await workbook.xlsx.load(buffer as any);
    } catch {
      return { error: "Couldn't read that file — make sure it's the unmodified .xlsx export." };
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return { error: 'That file has no worksheet to read.' };
    }

    type ParsedPlayer = {
      teamName: string;
      firstName: string;
      lastName: string;
      guardianFirstName: string;
      guardianLastName: string;
      guardianEmail: string;
      guardianPhone: string;
    };
    type ParsedPersonnel = {
      teamName: string;
      role: string;
      firstName: string;
      lastName: string;
      email: string;
    };

    const players: ParsedPlayer[] = [];
    const personnel: ParsedPersonnel[] = [];
    const teamNamesSeen = new Set<string>();

    let currentTeam = '';
    let mode: 'none' | 'players' | 'personnel' = 'none';

    sheet.eachRow({ includeEmpty: false }, (row) => {
      const a = cellText(row.getCell(1));
      const b = cellText(row.getCell(2));
      const c = cellText(row.getCell(3));
      const d = cellText(row.getCell(4));
      const e = cellText(row.getCell(5));
      const f = cellText(row.getCell(6));
      const g = cellText(row.getCell(7));

      if (a.startsWith('Team Name:')) {
        currentTeam = a.slice('Team Name:'.length).trim();
        teamNamesSeen.add(currentTeam);
        mode = 'none';
        return;
      }
      if (a === 'Team Players') {
        mode = 'players';
        return;
      }
      if (a === 'Team Personnel') {
        mode = 'personnel';
        return;
      }
      if (b === 'Player First Name' || b === 'Volunteer Role') {
        return; // sub-table header row, not data
      }
      if (a.startsWith('Program Name:') || a.startsWith('Division Name:')) {
        return;
      }
      if (!currentTeam || !/^\d+$/.test(a)) return; // not a numbered data row

      if (mode === 'players') {
        if (!b && !c) return;
        players.push({
          teamName: currentTeam,
          firstName: b,
          lastName: c,
          guardianFirstName: d,
          guardianLastName: e,
          guardianEmail: f,
          guardianPhone: g,
        });
      } else if (mode === 'personnel') {
        if (!c && !d) return;
        personnel.push({ teamName: currentTeam, role: b, firstName: c, lastName: d, email: e });
      }
    });

    if (players.length === 0 && personnel.length === 0) {
      return { error: "Couldn't find any team roster data in that file — is this a Team Roster Report export?" };
    }

    const unmatchedTeamNames = new Set<string>();

    const coachRows: CoachImportRow[] = [];
    for (const p of personnel) {
      const teamId = teamIdByName.get(p.teamName.trim().toLowerCase());
      if (!teamId) {
        unmatchedTeamNames.add(p.teamName);
        continue;
      }
      if (!p.firstName || !p.lastName) continue;
      coachRows.push({
        teamId,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        role: normalizeVolunteerRole(p.role),
      });
    }

    const rosterRows: RosterImportRow[] = [];
    for (const pl of players) {
      const teamId = teamIdByName.get(pl.teamName.trim().toLowerCase());
      if (!teamId) {
        unmatchedTeamNames.add(pl.teamName);
        continue;
      }
      if (!pl.firstName || !pl.lastName) continue;
      rosterRows.push({
        teamId,
        firstName: pl.firstName,
        lastName: pl.lastName,
        jerseyNumber: '',
        email: '', // this report never carries the player's own email — see header comment
        guardianFirstName: pl.guardianFirstName,
        guardianLastName: pl.guardianLastName,
        guardianEmail: pl.guardianEmail,
        guardianPhone: pl.guardianPhone,
      });
    }

    // Coaches first: a Team Manager is frequently the same person as a
    // player's Account/guardian (same email) — running coaches first
    // means that person's placeholder gets created here, and the roster
    // import's guardian resolution (which matches by email against the
    // same people table) picks up the same person rather than creating a
    // second one. Either order is correct either way since both sides
    // resolve by email, but this order avoids the redundant lookup.
    let coachResult = { staffed: 0, skipped: 0, peopleCreated: 0 };
    if (coachRows.length > 0) {
      const result = await bulkImportCoaches(organizationId, divisionId, coachRows);
      if ('error' in result) return { error: `Importing coaches failed: ${result.error}` };
      coachResult = result;
    }

    let rosterResult = { registered: 0, skipped: 0, peopleCreated: 0 };
    if (rosterRows.length > 0) {
      const result = await bulkImportRoster(organizationId, divisionId, rosterRows);
      if ('error' in result) return { error: `Importing players failed: ${result.error}` };
      rosterResult = result;
    }

    return {
      teamsFound: teamNamesSeen.size,
      unmatchedTeamNames: Array.from(unmatchedTeamNames),
      coachResult,
      rosterResult,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
