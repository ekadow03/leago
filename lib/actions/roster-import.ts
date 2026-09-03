'use server';

// lib/actions/roster-import.ts
//
// Bulk player roster assignment from a CSV upload, one row per player per
// team — same shape as lib/actions/coach-import.ts (which itself mirrors
// team-import.ts): auth check -> admin client -> defense-in-depth
// division/org check -> resolve/create people -> dedupe -> single batch
// insert -> { error } instead of throwing.
//
// This bypasses the normal public registration/draft flow entirely
// (registrations.ts's real signup path) — it's for backfilling a roster
// that's already decided outside leago (a spreadsheet from a league that
// hasn't used in-app registration/draft before), so rows go straight in
// as status 'confirmed' rather than 'pending' or going through payment.
//
// A row with no email still gets a placeholder person created (see
// coach-import.ts's comment on this same tradeoff) — including an email
// avoids creating a duplicate person on a re-upload.
//
// `email` above is the PLAYER's own email, when a source actually has
// one (e.g. an older teen with their own address) — used to match/dedupe
// the player's own person record. The optional guardian* fields are a
// separate identity entirely: some rosters (e.g. a "Team Roster Report"
// export) only carry an "Account" — a parent/guardian's name/email/
// phone — never the player's own contact info. Attaching THAT email to
// the player's own person row would be wrong (it isn't theirs, and could
// let the wrong person's account later match to a child's record) — so
// when guardian info is given, it resolves to its OWN person (matched/
// created by guardianEmail, same as everything else here) and is linked
// via registrations.submitted_by_person_id, which is exactly what that
// column is for ("who submitted this registration, if not the
// registrant themselves").

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';
import { revalidatePath } from 'next/cache';

export interface RosterImportRow {
  teamId: string;
  firstName: string;
  lastName: string;
  jerseyNumber: string; // '' when not provided
  email: string; // '' when not provided — the PLAYER's own email, if any
  guardianFirstName?: string;
  guardianLastName?: string;
  guardianEmail?: string;
  guardianPhone?: string;
}

type BulkImportRosterResult =
  | { registered: number; skipped: number; peopleCreated: number }
  | { error: string };

export async function bulkImportRoster(
  organizationId: string,
  divisionId: string,
  rows: RosterImportRow[]
): Promise<BulkImportRosterResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_divisions');
    if (!authorized) {
      return { error: 'You do not have permission to import a roster.' };
    }

    const cleaned = rows
      .map((r) => ({
        ...r,
        firstName: r.firstName.trim(),
        lastName: r.lastName.trim(),
        email: r.email.trim().toLowerCase(),
        jerseyNumber: r.jerseyNumber.trim(),
        guardianFirstName: r.guardianFirstName?.trim() || '',
        guardianLastName: r.guardianLastName?.trim() || '',
        guardianEmail: r.guardianEmail?.trim().toLowerCase() || '',
        guardianPhone: r.guardianPhone?.trim() || '',
      }))
      .filter((r) => r.teamId && r.firstName && r.lastName);

    if (cleaned.length === 0) {
      return { error: 'No valid rows found in the file.' };
    }

    const admin = createAdminClient();

    // Defense in depth (admin client bypasses RLS) — same pattern as
    // team-import.ts / coach-import.ts.
    const { data: division } = await admin
      .from('divisions')
      .select('id, season_id, seasons ( organization_id )')
      .eq('id', divisionId)
      .single();
    const orgId = (division?.seasons as any)?.organization_id;
    if (!division || orgId !== organizationId) {
      return { error: 'Division not found for this organization.' };
    }
    const seasonId = division.season_id as string;

    const { data: divisionTeams } = await admin.from('teams').select('id').eq('division_id', divisionId);
    const validTeamIds = new Set((divisionTeams ?? []).map((t) => t.id));
    const valid = cleaned.filter((r) => validTeamIds.has(r.teamId));
    if (valid.length === 0) {
      return { error: "None of the rows' teams belong to this division." };
    }

    // ---- Resolve each row to a person — same approach as
    // coach-import.ts's resolvePersonId (match by email, else create one
    // placeholder person per distinct new email/no-email row). ----
    const emails = Array.from(new Set(valid.map((r) => r.email).filter(Boolean)));
    const { data: existingPeople } =
      emails.length > 0
        ? await admin.from('people').select('id, email').in('email', emails)
        : { data: [] as { id: string; email: string | null }[] };
    const personIdByEmail = new Map<string, string>();
    for (const p of existingPeople ?? []) {
      if (p.email) personIdByEmail.set(p.email.toLowerCase(), p.id);
    }

    const newPersonKeyForRow = new Map<number, string>();
    const newPeopleByKey = new Map<string, { first_name: string; last_name: string; email: string | null }>();
    valid.forEach((row, i) => {
      if (row.email && personIdByEmail.has(row.email)) return;
      const key = row.email ? `email:${row.email}` : `noemail:${i}`;
      newPersonKeyForRow.set(i, key);
      if (!newPeopleByKey.has(key)) {
        newPeopleByKey.set(key, { first_name: row.firstName, last_name: row.lastName, email: row.email || null });
      }
    });

    let peopleCreated = 0;
    const keyToNewPersonId = new Map<string, string>();
    if (newPeopleByKey.size > 0) {
      const keys = Array.from(newPeopleByKey.keys());
      const { data: inserted, error: peopleError } = await admin
        .from('people')
        .insert(keys.map((k) => newPeopleByKey.get(k)!))
        .select('id');
      if (peopleError || !inserted) {
        return { error: `Failed to create new people: ${peopleError?.message ?? 'unknown error'}` };
      }
      keys.forEach((k, idx) => keyToNewPersonId.set(k, inserted[idx].id));
      peopleCreated = inserted.length;
    }

    function resolvePersonId(row: RosterImportRow, i: number): string {
      if (row.email && personIdByEmail.has(row.email)) return personIdByEmail.get(row.email)!;
      return keyToNewPersonId.get(newPersonKeyForRow.get(i)!)!;
    }

    const allPersonIds = Array.from(new Set(valid.map((row, i) => resolvePersonId(row, i))));

    // ---- Resolve guardian/submitter rows the same way, but as a fully
    // separate identity pool from the players above — a guardian's email
    // must never collide with (or get merged into) a player's own person
    // record just because both maps use "match by email". Only rows that
    // actually carry a guardianEmail participate; rows with a guardian
    // name but no email still get a placeholder (mirrors the no-email
    // player behavior), keyed per-row so two guardians who both lack an
    // email don't get merged into one person. ----
    const guardianRows = valid
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => row.guardianFirstName || row.guardianLastName || row.guardianEmail || row.guardianPhone);

    const guardianEmails = Array.from(new Set(guardianRows.map(({ row }) => row.guardianEmail).filter(Boolean)));
    const { data: existingGuardians } =
      guardianEmails.length > 0
        ? await admin.from('people').select('id, email').in('email', guardianEmails)
        : { data: [] as { id: string; email: string | null }[] };
    const guardianIdByEmail = new Map<string, string>();
    for (const p of existingGuardians ?? []) {
      if (p.email) guardianIdByEmail.set(p.email.toLowerCase(), p.id);
    }

    const newGuardianKeyForRow = new Map<number, string>();
    const newGuardiansByKey = new Map<
      string,
      { first_name: string; last_name: string; email: string | null; phone: string | null }
    >();
    guardianRows.forEach(({ row, i }) => {
      if (row.guardianEmail && guardianIdByEmail.has(row.guardianEmail)) return;
      const key = row.guardianEmail ? `email:${row.guardianEmail}` : `noemail:${i}`;
      newGuardianKeyForRow.set(i, key);
      if (!newGuardiansByKey.has(key)) {
        newGuardiansByKey.set(key, {
          first_name: row.guardianFirstName || 'Unknown',
          last_name: row.guardianLastName || 'Guardian',
          email: row.guardianEmail || null,
          phone: row.guardianPhone || null,
        });
      }
    });

    const guardianKeyToNewPersonId = new Map<string, string>();
    if (newGuardiansByKey.size > 0) {
      const keys = Array.from(newGuardiansByKey.keys());
      const { data: inserted, error: guardianError } = await admin
        .from('people')
        .insert(keys.map((k) => newGuardiansByKey.get(k)!))
        .select('id');
      if (guardianError || !inserted) {
        return { error: `Failed to create guardian contacts: ${guardianError?.message ?? 'unknown error'}` };
      }
      keys.forEach((k, idx) => guardianKeyToNewPersonId.set(k, inserted[idx].id));
      peopleCreated += inserted.length;
    }

    function resolveGuardianPersonId(row: RosterImportRow, i: number): string | null {
      if (!row.guardianFirstName && !row.guardianLastName && !row.guardianEmail && !row.guardianPhone) return null;
      if (row.guardianEmail && guardianIdByEmail.has(row.guardianEmail)) return guardianIdByEmail.get(row.guardianEmail)!;
      const key = newGuardianKeyForRow.get(i);
      return key ? (guardianKeyToNewPersonId.get(key) ?? null) : null;
    }

    // A player can only have one active (pending/confirmed) registration
    // per season — see 0002_registrations.sql's
    // unique(person_id, season_id, registration_type, status). Skip
    // anyone who already has one this season (whatever team it's under)
    // rather than letting that constraint reject the whole batch insert.
    const { data: existingRegs } = await admin
      .from('registrations')
      .select('person_id')
      .eq('season_id', seasonId)
      .eq('registration_type', 'player')
      .in('status', ['pending', 'confirmed'])
      .in('person_id', allPersonIds);
    const alreadyRegistered = new Set((existingRegs ?? []).map((r) => r.person_id));

    const seenInBatch = new Set<string>();
    const toInsert: {
      organization_id: string;
      season_id: string;
      division_id: string;
      team_id: string;
      person_id: string;
      registration_type: 'player';
      status: 'confirmed';
      jersey_number: string | null;
      submitted_by_person_id: string | null;
    }[] = [];
    let skipped = 0;

    valid.forEach((row, i) => {
      const personId = resolvePersonId(row, i);
      if (alreadyRegistered.has(personId) || seenInBatch.has(personId)) {
        skipped++;
        return;
      }
      seenInBatch.add(personId);
      toInsert.push({
        organization_id: organizationId,
        season_id: seasonId,
        division_id: divisionId,
        team_id: row.teamId,
        person_id: personId,
        registration_type: 'player',
        status: 'confirmed',
        jersey_number: row.jerseyNumber || null,
        submitted_by_person_id: resolveGuardianPersonId(row, i),
      });
    });

    let registered = 0;
    if (toInsert.length > 0) {
      const { data: inserted, error } = await admin.from('registrations').insert(toInsert).select('id');
      if (error) {
        return { error: `Failed to add players: ${error.message}` };
      }
      registered = inserted?.length ?? 0;
    }

    revalidatePath('/admin/teams');
    return { registered, skipped, peopleCreated };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
