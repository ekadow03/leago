// lib/org-context.ts
// Central place to resolve "who is this user, and what orgs/roles do they
// have" for use across Server Actions and pages. Every multi-tenant page
// should call this rather than querying organization_members directly, so
// there's one place to change if the membership model evolves.

import { createClient } from '@/lib/supabase/server';

export type OrgRole = 'player' | 'parent' | 'coach' | 'volunteer' | 'admin';

export interface OrgMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  personId: string;
  roles: OrgRole[];
}

/**
 * Returns every organization the current authenticated user belongs to,
 * with their role(s) in each. Relies entirely on RLS (0001_foundation.sql,
 * "org members can read their org's membership list") — no service role
 * key involved, so this can never leak another user's memberships.
 */
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
    .eq('status', 'active');

  if (error || !data) return [];

  // Collapse multiple role-rows for the same org into one membership entry.
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
      });
    }
  }

  return Array.from(byOrg.values());
}

/**
 * Convenience check for gating admin-only Server Actions. Cheap to call
 * repeatedly — it's a single indexed lookup, and RLS backs it regardless,
 * so this is a UX/early-exit guard, not the actual security boundary.
 */
export async function requireOrgAdmin(organizationId: string): Promise<boolean> {
  const memberships = await getCurrentUserMemberships();
  return memberships.some(
    (m) => m.organizationId === organizationId && m.roles.includes('admin')
  );
}
