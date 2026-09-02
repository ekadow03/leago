// lib/org-context.ts
// Central place to resolve "who is this user, and what orgs/roles/
// permissions do they have" for use across Server Actions and pages.
//
// OrgRole, OrgPermission, and ALL_ORG_PERMISSIONS live in
// lib/org-permissions.ts (a client-safe module with no next/headers
// dependency) and are re-exported here for the many existing server-side
// imports from '@/lib/org-context'. Client Components must import those
// three directly from '@/lib/org-permissions' instead of from this file —
// this file pulls in lib/supabase/server (next/headers), which Turbopack
// refuses to bundle into a client chunk.

import { createClient } from '@/lib/supabase/server';
import { ALL_ORG_PERMISSIONS, type OrgPermission, type OrgRole } from '@/lib/org-permissions';

export { ALL_ORG_PERMISSIONS };
export type { OrgPermission, OrgRole };

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
