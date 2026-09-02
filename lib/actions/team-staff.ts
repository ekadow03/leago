'use server';

// lib/actions/team-staff.ts
//
// Coaches/volunteers attached to a specific team roster (0023_team_staff.sql
// — replaces the never-used teams.coach_person_id). Gated on
// manage_divisions, same as team setup in lib/actions/teams.ts, since
// this is part of the same "set up my teams" job.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';
import { revalidatePath } from 'next/cache';

export type TeamStaffRole = 'head_coach' | 'assistant_coach' | 'volunteer';

export interface TeamStaffRow {
  id: string;
  personId: string;
  firstName: string;
  lastName: string;
  role: TeamStaffRole;
}

async function resolveTeamOrg(admin: ReturnType<typeof createAdminClient>, teamId: string): Promise<string | null> {
  const { data: team } = await admin
    .from('teams')
    .select('id, divisions ( seasons ( organization_id ) )')
    .eq('id', teamId)
    .single();

  return (team?.divisions as any)?.seasons?.organization_id ?? null;
}

export async function getTeamStaff(
  organizationId: string,
  teamId: string
): Promise<TeamStaffRow[] | { error: string }> {
  const authorized = await requireOrgPermission(organizationId, 'manage_divisions');
  if (!authorized) {
    return { error: 'You do not have permission to view team staff.' };
  }

  const admin = createAdminClient();

  const orgId = await resolveTeamOrg(admin, teamId);
  if (orgId !== organizationId) {
    return { error: 'Team not found for this organization.' };
  }

  const { data, error } = await admin
    .from('team_staff')
    .select('id, person_id, role, people ( first_name, last_name )')
    .eq('team_id', teamId);

  if (error) {
    return { error: error.message };
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    personId: row.person_id,
    firstName: row.people.first_name,
    lastName: row.people.last_name,
    role: row.role as TeamStaffRole,
  }));
}

export async function addTeamStaff(
  organizationId: string,
  teamId: string,
  personId: string,
  role: TeamStaffRole
): Promise<{ ok: true } | { error: string }> {
  const authorized = await requireOrgPermission(organizationId, 'manage_divisions');
  if (!authorized) {
    return { error: 'You do not have permission to manage team staff.' };
  }

  const admin = createAdminClient();

  const orgId = await resolveTeamOrg(admin, teamId);
  if (orgId !== organizationId) {
    return { error: 'Team not found for this organization.' };
  }

  // Defense in depth: confirm this person is actually a member of this
  // org before attaching them to a team roster — the admin client
  // bypasses RLS.
  const { data: membership } = await admin
    .from('organization_members')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('person_id', personId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return { error: 'That person is not a member of your organization — add them on the Members page first.' };
  }

  const { error } = await admin.from('team_staff').insert({ team_id: teamId, person_id: personId, role });

  if (error) {
    if (error.code === '23505') {
      return { error: 'That person already has a role on this team — remove it first to change their role.' };
    }
    return { error: `Failed to add team staff: ${error.message}` };
  }

  revalidatePath(`/admin/teams/${teamId}`);
  return { ok: true };
}

export async function removeTeamStaff(
  organizationId: string,
  teamId: string,
  staffId: string
): Promise<{ ok: true } | { error: string }> {
  const authorized = await requireOrgPermission(organizationId, 'manage_divisions');
  if (!authorized) {
    return { error: 'You do not have permission to manage team staff.' };
  }

  const admin = createAdminClient();

  const orgId = await resolveTeamOrg(admin, teamId);
  if (orgId !== organizationId) {
    return { error: 'Team not found for this organization.' };
  }

  const { error } = await admin.from('team_staff').delete().eq('id', staffId).eq('team_id', teamId);

  if (error) {
    return { error: `Failed to remove team staff: ${error.message}` };
  }

  revalidatePath(`/admin/teams/${teamId}`);
  return { ok: true };
}
