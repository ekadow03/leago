// lib/org-context.ts
// Central place to resolve "who is this user, and what orgs/roles/
// permissions do they have" for use across Server Actions and pages.

import { createClient } from '@/lib/supabase/server';

export type OrgRole = 'player' | 'parent' | 'coach' | 'volunteer' | 'admin';

// Mirrors the check constraint on organization_permissions.permission in
// 0022_delegated_permissions.sql — keep these two lists in sync. An org
// admin implicitly has every permission (see requireOrgPermission below
// and that migration's has_org_permission() SQL function) and never
// needs a row in organization_permissions.
export type OrgPermission =
  | 'manage_members'
  | 'manage_divisions'
  | 'manage_registrations'
  | 'manage_compliance'
  | 'manage_evaluations'
  | 'manage_draft'
  | 'manage_schedule'
  | 'manage_volunteers'
  | 'manage_tournaments'
  | 'manage_communications';

export interface OrgMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  personId: string;
  roles: OrgRole[];
  permissions: OrgPermission[];
}

export async function getCurrentUserMemberships(): Promise<OrgMembership[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data, error } = await supabase
    .from('organization_members')
    .select(
      `
      organization_id,
      role,
      status,
      people!organization_members_person_id_fkey ( id, auth_user_id ),
      organizations!inner ( id, name, slug )
    `
    )
    .eq('people.auth_user_id', user.id)
    .eq('status', 'active')
    // Most-recently-created membership first. Several pages resolve
    // "the" org an admin is working in via memberships[0] with no
    // switcher UI — without this, Postgres returns rows in whatever
    // order it finds them (not necessarily creation order), so a newly
    // created league could effectively vanish behind an older one.
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  const byOrg = new Map<string, OrgMembership>();

  for (const row of data as any[]) {
    const org = row.organizations;
    const existing = byOrg.get(org.id);
    if (existing) {
      existing.roles.push(row.role);
    } else {
      byOrg.set(org.id, {
        organizationId: org.id,
        organizationName: org.name,
        organizationSlug: org.slug,
        personId: row.people.id,
        roles: [row.role],
        permissions: [],
      });
    }
  }

  const memberships = Array.from(byOrg.values());
  if (memberships.length === 0) return memberships;

  // A single person_id can appear in more than one org (rare, but the
  // schema allows it), so pair permission rows back up by
  // (organization_id, person_id) rather than assuming person_id alone
  // is unique across the results.
  const { data: permissionRows } = await supabase
    .from('organization_permissions')
    .select('organization_id, person_id, permission')
    .in(
      'person_id',
      memberships.map((m) => m.personId)
    );

  for (const row of (permissionRows ?? []) as { organization_id: string; person_id: string; permission: OrgPermission }[]) {
    const membership = memberships.find(
      (m) => m.organizationId === row.organization_id && m.personId === row.person_id
    );
    membership?.permissions.push(row.permission);
  }

  return memberships;
}

// Strictly "is this user a full admin of this org" — use for actions that
// must never be delegable (org settings, billing, granting roles/
// permissions to others). For anything else, prefer requireOrgPermission
// so the task can be handed to a non-admin board member/manager.
export async function requireOrgAdmin(organizationId: string): Promise<boolean> {
  const memberships = await getCurrentUserMemberships();
  return memberships.some(
    (m) => m.organizationId === organizationId && m.roles.includes('admin')
  );
}

// Is this user an admin of this org, OR have they been granted this
// specific delegated permission? Mirrors has_org_permission() in
// 0022_delegated_permissions.sql — use this (not requireOrgAdmin) for any
// task an admin should be able to delegate to a board member/manager.
export async function requireOrgPermission(
  organizationId: string,
  permission: OrgPermission
): Promise<boolean> {
  const memberships = await getCurrentUserMemberships();
  return memberships.some(
    (m) =>
      m.organizationId === organizationId &&
      (m.roles.includes('admin') || m.permissions.includes(permission))
  );
}
