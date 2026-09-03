// app/admin/teams/page.tsx
//
// Org-wide team management, split out of the per-division Season Builder
// screen so admins have one place to add/import every division's teams
// before jumping into that division's schedule. Season Builder now just
// links here instead of embedding its own team form.
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import Nav from '@/components/nav';
import AdminNav from '@/components/admin-nav';
import TeamsManager from './teams-manager';

export default async function AdminTeamsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/admin/teams');
  }

  const memberships = await getCurrentUserMemberships();
  const adminOrgs = memberships.filter(
    (m) => m.roles.includes('admin') || m.permissions.includes('manage_divisions')
  );

  if (adminOrgs.length === 0) {
    return (
      <div className="admin-page">
        <Nav />
        <AdminNav active="/admin/teams" />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>You&apos;re not an admin of any organization.</p>
        </div>
      </div>
    );
  }

  const org = adminOrgs[0];

  const { data: seasons } = await supabase
    .from('seasons')
    .select('id, name')
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false });

  const seasonIds = (seasons ?? []).map((s) => s.id);

  const { data: divisions } = seasonIds.length
    ? await supabase
        .from('divisions')
        .select('id, season_id, name')
        .in('season_id', seasonIds)
        .order('name', { ascending: true })
    : { data: [] as { id: string; season_id: string; name: string }[] };

  const divisionIds = (divisions ?? []).map((d) => d.id);

  const { data: teams } = divisionIds.length
    ? await supabase
        .from('teams')
        .select('id, name, division_id')
        .in('division_id', divisionIds)
        .order('name', { ascending: true })
    : { data: [] as { id: string; name: string; division_id: string }[] };

  const teamIds = (teams ?? []).map((t) => t.id);

  // Per-team player/coach counts for the teams table below — fetched as
  // raw team_id rows and counted here rather than a grouped query, since
  // supabase-js has no simple "count per group" select. Mirrors the same
  // "rostered" definition roster-import.ts's dedupe check uses (pending
  // or confirmed only — a canceled/waitlisted registration doesn't count
  // as being on the team).
  const { data: rosterRows } = teamIds.length
    ? await supabase
        .from('registrations')
        .select('team_id')
        .eq('registration_type', 'player')
        .in('status', ['pending', 'confirmed'])
        .in('team_id', teamIds)
    : { data: [] as { team_id: string | null }[] };

  const { data: staffRows } = teamIds.length
    ? await supabase.from('team_staff').select('team_id').in('team_id', teamIds)
    : { data: [] as { team_id: string }[] };

  const teamStats: Record<string, { players: number; coaches: number }> = {};
  for (const id of teamIds) teamStats[id] = { players: 0, coaches: 0 };
  for (const r of rosterRows ?? []) {
    if (r.team_id && teamStats[r.team_id]) teamStats[r.team_id].players++;
  }
  for (const s of staffRows ?? []) {
    if (teamStats[s.team_id]) teamStats[s.team_id].coaches++;
  }

  return (
    <div className="admin-page">
      <Nav />
      <AdminNav active="/admin/teams" />
      <div className="admin-header">
        <h1>Teams</h1>
        <p>{org.organizationName}</p>
      </div>
      <div className="admin-body">
        <TeamsManager
          organizationId={org.organizationId}
          seasons={seasons ?? []}
          divisions={divisions ?? []}
          initialTeams={teams ?? []}
          initialTeamStats={teamStats}
        />
      </div>
    </div>
  );
}
