'use server';

// lib/actions/members.ts
//
// Admin-only: list an org's members, add a new one by email, remove a
// role, and grant/revoke the delegated permissions added in
// 0022_delegated_permissions.sql (see lib/org-context.ts's OrgPermission).
// Deliberately gated on requireOrgAdmin everywhere, never
// requireOrgPermission — letting a delegate manage other members'
// permissions would let them grant themselves (or anyone) admin.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin, type OrgPermission, type OrgRole } from '@/lib/org-context';
import { revalidatePath } from 'next/cache';

export const ALL_ORG_PERMISSIONS: { key: OrgPermission; label: string }[] = [
  { key: 'manage_members', label: 'Manage members' },
  { key: 'manage_divisions', label: 'Set up seasons, divisions & teams' },
  { key: 'manage_registrations', label: 'Handle registrations & refunds' },
  { key: 'manage_compliance', label: 'Review compliance documents' },
  { key: 'manage_evaluations', label: 'Record player evaluations' },
  { key: 'manage_draft', label: 'Run the draft' },
  { key: 'manage_schedule', label: 'Build the schedule' },
  { key: 'manage_volunteers', label: 'Manage volunteer shifts' },
  { key: 'manage_tournaments', label: 'Run tournaments' },
  { key: 'manage_communications', label: 'Post announcements' },
];

const PERMISSION_KEYS = ALL_ORG_PERMISSIONS.map((p) => p.key);

export interface OrgMemberRow {
  personId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  roles: OrgRole[];
  permissions: OrgPermission[];
}

export async function getOrgMembers(organizationId: string): Promise<OrgMemberRow[] | { error: string }> {
  const authorized = await requireOrgAdmin(organizationId);
  if (!authorized) {
    return { error: 'You do not have permission to view members.' };
  }

  const admin = createAdminClient();

  const { data: memberRows, error } = await admin
    .from('organization_members')
    .select('person_id, role, people ( id, first_name, last_name, email )')
    .eq('organization_id', organizationId)
    .eq('status', 'active');

  if (error) {
    return { error: error.message };
  }

  const { data: permissionRows } = await admin
    .from('organization_permissions')
    .select('person_id, permission')
    .eq('organization_id', organizationId);

  const byPerson = new Map<string, OrgMemberRow>();

  for (const row of (memberRows ?? []) as any[]) {
    const person = row.people;
    const existing = byPerson.get(row.person_id);
    if (existing) {
      existing.roles.push(row.role);
    } else {
      byPerson.set(row.person_id, {
        personId: row.person_id,
        firstName: person.first_name,
        lastName: person.last_name,
        email: person.email,
        roles: [row.role as OrgRole],
        permissions: [],
      });
    }
  }

  for (const row of (permissionRows ?? []) as { person_id: string; permission: OrgPermission }[]) {
    byPerson.get(row.person_id)?.permissions.push(row.permission);
  }

  return Array.from(byPerson.values()).sort((a, b) => a.firstName.localeCompare(b.firstName));
}

interface AddMemberInput {
  organizationId: string;
  email: string;
  role: OrgRole;
}

export async function addMember(input: AddMemberInput): Promise<{ ok: true } | { error: string }> {
  const authorized = await requireOrgAdmin(input.organizationId);
  if (!authorized) {
    return { error: 'You do not have permission to add members.' };
  }

  const email = input.email.trim().toLowerCase();
  if (!email) {
    return { error: 'Email is required.' };
  }

  const admin = createAdminClient();

  // People sign up for leago as themselves first (there's no separate
  // "invite a stranger by email" flow yet) — this looks up an existing
  // account rather than creating one, so the admin has to ask the person
  // to create a leago account first if this comes back empty.
  const { data: person } = await admin.from('people').select('id').ilike('email', email).maybeSingle();

  if (!person) {
    return {
      error:
        "No leago account found for that email yet. Ask them to sign up at leago first, then add them here.",
    };
  }

  const { error } = await admin.from('organization_members').insert({
    organization_id: input.organizationId,
    person_id: person.id,
    role: input.role,
  });

  if (error) {
    if (error.code === '23505') {
      return { error: 'That person already has that role in your organization.' };
    }
    return { error: `Failed to add member: ${error.message}` };
  }

  revalidatePath('/admin/members');
  return { ok: true };
}

export async function removeMemberRole(
  organizationId: string,
  personId: string,
  role: OrgRole
): Promise<{ ok: true } | { error: string }> {
  const authorized = await requireOrgAdmin(organizationId);
  if (!authorized) {
    return { error: 'You do not have permission to remove members.' };
  }

  const admin = createAdminClient();

  if (role === 'admin') {
    // Defense in depth: never leave an org with zero admins — same
    // safety principle as the existing "delete season" guard elsewhere
    // in the codebase (refuse rather than orphan the org).
    const { count } = await admin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('role', 'admin')
      .eq('status', 'active');

    if ((count ?? 0) <= 1) {
      return { error: 'Cannot remove the last admin — make someone else an admin first.' };
    }
  }

  const { error } = await admin
    .from('organization_members')
    .delete()
    .eq('organization_id', organizationId)
    .eq('person_id', personId)
    .eq('role', role);

  if (error) {
    return { error: error.message };
  }

  // A person removed entirely from the org (no roles left) shouldn't
  // keep any delegated permissions there either.
  const { count: remainingRoles } = await admin
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('person_id', personId);

  if ((remainingRoles ?? 0) === 0) {
    await admin
      .from('organization_permissions')
      .delete()
      .eq('organization_id', organizationId)
      .eq('person_id', personId);
  }

  revalidatePath('/admin/members');
  return { ok: true };
}

export async function setMemberPermissions(
  organizationId: string,
  personId: string,
  permissions: OrgPermission[]
): Promise<{ ok: true } | { error: string }> {
  const authorized = await requireOrgAdmin(organizationId);
  if (!authorized) {
    return { error: 'You do not have permission to change permissions.' };
  }

  const valid = permissions.filter((p) => PERMISSION_KEYS.includes(p));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'You must be logged in.' };
  }
  const { data: me } = await supabase.from('people').select('id').eq('auth_user_id', user.id).single();

  const admin = createAdminClient();

  // Defense in depth: confirm personId is actually an active member of
  // this org before granting anything — the admin client bypasses RLS.
  const { data: membership } = await admin
    .from('organization_members')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('person_id', personId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return { error: 'That person is not a member of your organization.' };
  }

  const { error: deleteError } = await admin
    .from('organization_permissions')
    .delete()
    .eq('organization_id', organizationId)
    .eq('person_id', personId);

  if (deleteError) {
    return { error: deleteError.message };
  }

  if (valid.length > 0) {
    const { error: insertError } = await admin.from('organization_permissions').insert(
      valid.map((permission) => ({
        organization_id: organizationId,
        person_id: personId,
        permission,
        granted_by_person_id: me?.id ?? null,
      }))
    );

    if (insertError) {
      return { error: insertError.message };
    }
  }

  revalidatePath('/admin/members');
  return { ok: true };
}
