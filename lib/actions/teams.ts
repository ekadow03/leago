'use server';

// lib/actions/teams.ts
//
// Single-team creation for the season builder's "add a team manually"
// path, alongside the existing CSV bulk-import in team-import.ts. Returns
// { error } instead of throwing, and wraps the whole body in a try/catch —
// see the comment in lib/actions/onboarding.ts for why.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

type CreateTeamResult = { id: string; name: string } | { error: string };

export async function createTeam(
  organizationId: string,
  divisionId: string,
  name: string
): Promise<CreateTeamResult> {
  try {
    const isAdmin = await requireOrgAdmin(organizationId);
    if (!isAdmin) {
      return { error: 'Only an organization admin can add a team.' };
    }

    const trimmed = name.trim();
    if (!trimmed) {
      return { error: 'Team name is required.' };
    }

    const admin = createAdminClient();

    // Defense in depth: confirm the division actually belongs to this org
    // before inserting, since the admin client bypasses RLS.
    const { data: division } = await admin
      .from('divisions')
      .select('id, seasons ( organization_id )')
      .eq('id', divisionId)
      .single();

    const orgId = (division?.seasons as any)?.organization_id;
    if (!division || orgId !== organizationId) {
      return { error: 'Division not found for this organization.' };
    }

    const { data, error } = await admin
      .from('teams')
      .insert({ division_id: divisionId, name: trimmed })
      .select('id, name')
      .single();

    if (error || !data) {
      return { error: `Failed to add team: ${error?.message}` };
    }

    return { id: data.id, name: data.name };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
