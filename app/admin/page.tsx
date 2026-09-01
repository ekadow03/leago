// app/admin/page.tsx
//
// Admin home: create seasons/divisions (previously only possible via raw
// SQL in Supabase) and jump into teams/schedule/draft for each division.
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import Nav from '@/components/nav';
import AdminNav from '@/components/admin-nav';
import SeasonManager from './season-manager';

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/admin');
  }

  const memberships = await getCurrentUserMemberships();
  const adminOrgs = memberships.filter((m) => m.roles.includes('admin'));

  if (adminOrgs.length === 0) {
    return (
      <div className="admin-page">
        <Nav />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>
            You're not an admin of any organization yet.{' '}
            <a href="/get-started" style={{ color: 'var(--green-dark)' }}>
              Create a league
            </a>{' '}
            to get started.
          </p>
        </div>
      </div>
    );
  }

  const org = adminOrgs[0];

  const { data: seasons } = await supabase
    .from('seasons')
    .select('id, name, status, registration_open_at, registration_close_at')
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false });

  const seasonIds = (seasons ?? []).map((s) => s.id);

  const { data: divisions } = seasonIds.length
    ? await supabase
        .from('divisions')
        .select('id, season_id, name, age_min, age_max, price_cents, schedule_priority')
        .in('season_id', seasonIds)
        .order('name', { ascending: true })
    : { data: [] as any[] };

  const divisionIds = (divisions ?? []).map((d) => d.id);

  const { data: teamRows } = divisionIds.length
    ? await supabase.from('teams').select('division_id').in('division_id', divisionIds)
    : { data: [] as any[] };

  const teamCounts: Record<string, number> = {};
  (teamRows ?? []).forEach((t: any) => {
    teamCounts[t.division_id] = (teamCounts[t.division_id] ?? 0) + 1;
  });

  const { data: fields } = await supabase
    .from('fields')
    .select('id, name')
    .eq('organization_id', org.organizationId)
    .order('name', { ascending: true });

  return (
    <div className="admin-page">
      <Nav />
      <AdminNav active="/admin" />
      <div className="admin-header">
        <h1>Dashboard</h1>
        <p>{org.organizationName}</p>
      </div>
      <div className="admin-body">
        <SeasonManager
          organizationId={org.organizationId}
          initialSeasons={seasons ?? []}
          initialDivisions={(divisions as any) ?? []}
          teamCounts={teamCounts}
          initialFields={fields ?? []}
        />
      </div>
    </div>
  );
}
