'use server';

// lib/actions/teams.ts
//
// Single-team creation for the season builder's "add a team manually"
// path, alongside the existing CSV bulk-import in team-import.ts. Returns
// { error } instead of throwing, and wraps the whole body in a try/catch —
// see the comment in lib/actions/onboarding.ts for why.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';

type CreateTeamResult = { id: string; name: string } | { error: string };

export async function createTeam(
  organizationId: string,
  divisionId: string,
  name: string
): Promise<CreateTeamResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_divisions');
    if (!authorized) {
      return { error: 'You do not have permission to add a team.' };
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

type DeleteTeamResult = { ok: true } | { error: string };

/** Removes one team. Any existing events referencing it as home/away just
 * lose that assignment (events.home_team_id/away_team_id are `on delete
 * set null`) rather than being deleted themselves — a generated schedule
 * stays intact but that game's team slot goes blank and needs
 * reassigning or regenerating. */
export async function deleteTeam(organizationId: string, teamId: string): Promise<DeleteTeamResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_divisions');
    if (!authorized) {
      return { error: 'You do not have permission to remove a team.' };
    }

    const admin = createAdminClient();

    // Defense in depth: confirm the team actually belongs to this org
    // (via its division's season) before deleting, since the admin
    // client bypasses RLS.
    const { data: team } = await admin
      .from('teams')
      .select('id, divisions ( seasons ( organization_id ) )')
      .eq('id', teamId)
      .single();

    const orgId = (team?.divisions as any)?.seasons?.organization_id;
    if (!team || orgId !== organizationId) {
      return { error: 'Team not found for this organization.' };
    }

    const { error } = await admin.from('teams').delete().eq('id', teamId);

    if (error) {
      return { error: `Failed to remove team: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}

type DeleteAllTeamsResult = { ok: true; count: number } | { error: string };

/** Removes every team in a division at once — same event/draft-pick
 * cascade behavior as deleteTeam(), just for all of them in one call
 * (e.g. to start a division's roster over from a corrected CSV). */
export async function deleteAllTeamsInDivision(
  organizationId: string,
  divisionId: string
): Promise<DeleteAllTeamsResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_divisions');
    if (!authorized) {
      return { error: 'You do not have permission to remove teams.' };
    }

    const admin = createAdminClient();

    const { data: division } = await admin
      .from('divisions')
      .select('id, seasons ( organization_id )')
      .eq('id', divisionId)
      .single();

    const orgId = (division?.seasons as any)?.organization_id;
    if (!division || orgId !== organizationId) {
      return { error: 'Division not found for this organization.' };
    }

    const { data, error } = await admin.from('teams').delete().eq('division_id', divisionId).select('id');

    if (error) {
      return { error: `Failed to remove teams: ${error.message}` };
    }

    return { ok: true, count: data?.length ?? 0 };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
