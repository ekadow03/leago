// app/admin/members/page.tsx
//
// Admin-only: manage who belongs to the org and what delegated
// permissions (0022_delegated_permissions.sql) they hold. Deliberately
// gated on the 'admin' role only, never a permission — granting
// permissions is itself one of the things that must stay admin-only (see
// lib/actions/members.ts).
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import Nav from '@/components/nav';
import AdminNav from '@/components/admin-nav';
import { getOrgMembers } from '@/lib/actions/members';
import MembersManager from './members-manager';

export default async function AdminMembersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/admin/members');
  }

  const memberships = await getCurrentUserMemberships();
  const adminOrgs = memberships.filter((m) => m.roles.includes('admin'));

  if (adminOrgs.length === 0) {
    return (
      <div className="admin-page">
        <Nav />
        <AdminNav active="/admin/members" />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>Only an organization admin can manage members and permissions.</p>
        </div>
      </div>
    );
  }

  const org = adminOrgs[0];
  const result = await getOrgMembers(org.organizationId);
  const members = Array.isArray(result) ? result : [];
  const loadError = Array.isArray(result) ? null : result.error;

  return (
    <div className="admin-page">
      <Nav />
      <AdminNav active="/admin/members" />
      <div className="admin-header">
        <h1>Members</h1>
        <p>{org.organizationName} — add board members/managers and choose what each one can do</p>
      </div>
      <div className="admin-body">
        {loadError ? (
          <p style={{ color: '#B23A2E' }}>{loadError}</p>
        ) : (
          <MembersManager organizationId={org.organizationId} initialMembers={members} />
        )}
      </div>
    </div>
  );
}
