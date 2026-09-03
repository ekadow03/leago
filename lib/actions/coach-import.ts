'use server';

// lib/actions/coach-import.ts
//
// Bulk coach/volunteer assignment from a CSV upload, one row per person
// per team. Mirrors lib/actions/team-import.ts's shape (auth check ->
// admin client -> defense-in-depth division/org check -> dedupe -> single
// batch insert -> { error } instead of throwing).
//
// Unlike team-import.ts (which deliberately left coach assignment out of
// scope because "that requires a real person/account, which a CSV import
// can't create safely"), this one DOES create people — but only as
// placeholder rows with no auth_user_id, which people.sql's own comment
// calls out as an explicitly supported state ("a person row can exist
// before they have platform login... invited but not yet signed up").
// If that person later signs up with the same email, it's their same
// person row already in place — see lib/actions/members.ts's addMember()
// for the read side of that same email-matching convention.
//
// A row with no email still gets a placeholder person created (there's
// no other identifier to key off of), which means re-uploading the same
// no-email row twice creates two separate people — the UI warns about
// this; including an email avoids it entirely.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';
import { revalidatePath } from 'next/cache';

export type CoachRole = 'head_coach' | 'assistant_coach' | 'volunteer';

export interface CoachImportRow {
  teamId: string;
  firstName: string;
  lastName: string;
  email: string; // '' when not provided
  role: CoachRole;
}

type BulkImportCoachesResult =
  | { staffed: number; skipped: number; peopleCreated: number }
  | { error: string };

export async function bulkImportCoaches(
  organizationId: string,
  divisionId: string,
  rows: CoachImportRow[]
): Promise<BulkImportCoachesResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_divisions');
    if (!authorized) {
      return { error: 'You do not have permission to import coaches.' };
    }

    const cleaned = rows
      .map((r) => ({
        ...r,
        firstName: r.firstName.trim(),
        lastName: r.lastName.trim(),
        email: r.email.trim().toLowerCase(),
      }))
      .filter((r) => r.teamId && r.firstName && r.lastName);

    if (cleaned.length === 0) {
      return { error: 'No valid rows found in the file.' };
    }

    const admin = createAdminClient();

    // Defense in depth: requireOrgPermission only checked the
    // caller-supplied organizationId, which the client controls — confirm
    // the division being written to actually belongs to that org before
    // inserting anything, since the admin client bypasses RLS.
    const { data: division } = await admin
      .from('divisions')
      .select('id, seasons ( organization_id )')
      .eq('id', divisionId)
      .single();
    const orgId = (division?.seasons as any)?.organization_id;
    if (!division || orgId !== organizationId) {
      return { error: 'Division not found for this organization.' };
    }

    const { data: divisionTeams } = await admin.from('teams').select('id').eq('division_id', divisionId);
    const validTeamIds = new Set((divisionTeams ?? []).map((t) => t.id));
    const valid = cleaned.filter((r) => validTeamIds.has(r.teamId));
    if (valid.length === 0) {
      return { error: "None of the rows' teams belong to this division." };
    }

    // ---- Resolve each row to a person, matching existing people by
    // email (case-insensitive) and only creating a new placeholder person
    // for rows that don't match one — deduped so two rows sharing one new
    // email (e.g. the same person coaching two teams) become one person,
    // not two. ----
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
      // Postgres returns RETURNING rows in insert order for a plain
      // VALUES-list insert, so this positional zip is safe.
      keys.forEach((k, idx) => keyToNewPersonId.set(k, inserted[idx].id));
      peopleCreated = inserted.length;
    }

    function resolvePersonId(row: CoachImportRow, i: number): string {
      if (row.email && personIdByEmail.has(row.email)) return personIdByEmail.get(row.email)!;
      return keyToNewPersonId.get(newPersonKeyForRow.get(i)!)!;
    }

    // ---- Every coach needs an org membership before team_staff will
    // accept them (see addTeamStaff's own defense-in-depth check) ----
    const allPersonIds = Array.from(new Set(valid.map((row, i) => resolvePersonId(row, i))));

    const { data: existingMemberships } = await admin
      .from('organization_members')
      .select('person_id')
      .eq('organization_id', organizationId)
      .eq('role', 'coach')
      .in('person_id', allPersonIds);
    const alreadyMember = new Set((existingMemberships ?? []).map((m) => m.person_id));
    const toAddMembership = allPersonIds.filter((id) => !alreadyMember.has(id));
    if (toAddMembership.length > 0) {
      const { error: memberError } = await admin
        .from('organization_members')
        .insert(toAddMembership.map((person_id) => ({ organization_id: organizationId, person_id, role: 'coach' as const })));
      if (memberError) {
        return { error: `Failed to add org membership: ${memberError.message}` };
      }
    }

    // ---- Attach to each row's team, skipping anyone already staffed
    // there (team_staff's own unique(team_id, person_id)) ----
    const { data: existingStaff } = await admin
      .from('team_staff')
      .select('team_id, person_id')
      .in('team_id', Array.from(validTeamIds));
    const existingStaffKeys = new Set((existingStaff ?? []).map((s) => `${s.team_id}|${s.person_id}`));

    const seenInBatch = new Set<string>();
    const toInsertStaff: { team_id: string; person_id: string; role: CoachRole }[] = [];
    let skipped = 0;

    valid.forEach((row, i) => {
      const personId = resolvePersonId(row, i);
      const key = `${row.teamId}|${personId}`;
      if (existingStaffKeys.has(key) || seenInBatch.has(key)) {
        skipped++;
        return;
      }
      seenInBatch.add(key);
      toInsertStaff.push({ team_id: row.teamId, person_id: personId, role: row.role });
    });

    let staffed = 0;
    if (toInsertStaff.length > 0) {
      const { data: inserted, error: staffError } = await admin.from('team_staff').insert(toInsertStaff).select('id');
      if (staffError) {
        return { error: `Failed to add team staff: ${staffError.message}` };
      }
      staffed = inserted?.length ?? 0;
    }

    revalidatePath('/admin/teams');
    return { staffed, skipped, peopleCreated };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
