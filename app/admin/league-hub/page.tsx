// app/admin/league-hub/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import LeagueHubAdmin from './league-hub-admin';
import Nav from '@/components/nav';

export default async function AdminLeagueHubPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/admin/league-hub');
  }

  const memberships = await getCurrentUserMemberships();
  const adminOrgs = memberships.filter((m) => m.roles.includes('admin'));

  if (adminOrgs.length === 0) {
    return (
      <div className="admin-page">
        <Nav />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>You're not an admin of any organization.</p>
        </div>
      </div>
    );
  }

  const org = adminOrgs[0];

  const { data: fullOrg } = await supabase
    .from('organizations')
    .select('id, slug, description, contact_email, contact_phone')
    .eq('id', org.organizationId)
    .single();

  const { data: announcements } = await supabase
    .from('announcements')
    .select('id, title, body, status, created_at')
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false });

  return (
    <div className="admin-page">
      <Nav />
      <div className="admin-header">
        <h1>League Hub</h1>
        <p>{org.organizationName}</p>
      </div>
      <div className="admin-body">
        <LeagueHubAdmin
          organizationId={org.organizationId}
          orgSlug={fullOrg?.slug ?? ''}
          currentDescription={fullOrg?.description ?? ''}
          currentContactEmail={fullOrg?.contact_email ?? ''}
          currentContactPhone={fullOrg?.contact_phone ?? ''}
          initialAnnouncements={announcements ?? []}
        />
      </div>
    </div>
  );
}