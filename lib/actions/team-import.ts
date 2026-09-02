'use server';

// lib/actions/team-import.ts
// Bulk team creation from a CSV upload — one row per team name. Keeps
// coach assignment out of scope here (that requires a real person/account,
// which a CSV import can't create safely) — teams come in with no coach
// assigned, same as if created one at a time via the existing UI.
//
// De-dupes against that division's EXISTING teams (case/whitespace
// insensitive) before inserting, and within the same upload too — without
// this, re-uploading a CSV that includes teams already imported earlier
// (the common case: a new division got added, so the whole season's CSV
// gets re-uploaded) would create a second copy of every team that was
// already there.
//
// Returns { error } instead of throwing, and wraps the whole body in a
// try/catch — see the comment in lib/actions/onboarding.ts for why.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';

type BulkCreateTeamsResult = { teams: { id: string; name: string }[]; skipped: string[] } | { error: string };

export async function bulkCreateTeams(
  organizationId: string,
  divisionId: string,
  teamNames: string[]
): Promise<BulkCreateTeamsResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_divisions');
    if (!authorized) {
      return { error: 'You do not have permission to import teams.' };
    }

    const cleaned = teamNames.map((n) => n.trim()).filter((n) => n.length > 0);

    if (cleaned.length === 0) {
      return { error: 'No valid team names found in the file.' };
    }

    const admin = createAdminClient();

    // Defense in depth: requireOrgPermission only checked the caller-supplied
    // organizationId, which the client controls — confirm the division
    // being written to actually belongs to that org before inserting,
    // since the admin client bypasses RLS.
    const { data: division } = await admin
      .from('divisions')
      .select('id, seasons ( organization_id )')
      .eq('id', divisionId)
      .single();

    const orgId = (division?.seasons as any)?.organization_id;
    if (!division || orgId !== organizationId) {
      return { error: 'Division not found for this organization.' };
    }

    const { data: existingTeams } = await admin
      .from('teams')
      .select('name')
      .eq('division_id', divisionId);

    const existingLower = new Set((existingTeams ?? []).map((t) => t.name.toLowerCase()));
    const seenLower = new Set<string>();
    const toInsert: string[] = [];
    const skipped: string[] = [];

    for (const name of cleaned) {
      const lower = name.toLowerCase();
      if (existingLower.has(lower) || seenLower.has(lower)) {
        skipped.push(name);
        continue;
      }
      seenLower.add(lower);
      toInsert.push(name);
    }

    if (toInsert.length === 0) {
      return { teams: [], skipped };
    }

    const { data, error } = await admin
      .from('teams')
      .insert(toInsert.map((name) => ({ division_id: divisionId, name })))
      .select('id, name');

    if (error) {
      return { error: `Failed to import teams: ${error.message}` };
    }

    return { teams: data ?? [], skipped };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
