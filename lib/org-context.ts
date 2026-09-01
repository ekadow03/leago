// lib/org-context.ts
// Central place to resolve "who is this user, and what orgs/roles do they
// have" for use across Server Actions and pages.

import { createClient } from '@/lib/supabase/server';

export type OrgRole = 'player' | 'parent' | 'coach' | 'volunteer' | 'admin';

export interface OrgMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  personId: string;
  roles: OrgRole[];
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
      });
    }
  }

  return Array.from(byOrg.values());
}

export async function requireOrgAdmin(organizationId: string): Promise<boolean> {
  const memberships = await getCurrentUserMemberships();
  return memberships.some(
    (m) => m.organizationId === organizationId && m.roles.includes('admin')
  );
}
