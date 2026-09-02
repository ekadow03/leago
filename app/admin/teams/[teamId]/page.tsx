// app/admin/teams/[teamId]/page.tsx
//
// One team's roster: the players drafted onto it (read-only here — see
// lib/actions/draft.ts for how they got there) and its coaching staff
// (0023_team_staff.sql), which is what this page is actually for.
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import Nav from '@/components/nav';
import AdminNav from '@/components/admin-nav';
import Link from 'next/link';
import { getTeamStaff } from '@/lib/actions/team-staff';
import { getOrgMembers } from '@/lib/actions/members';
import TeamRoster from './team-roster';

export default async function TeamDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/admin/teams/${teamId}`);
  }

  const { data: team } = await supabase
    .from('teams')
    .select('id, name, division_id, divisions ( id, name, season_id, seasons ( id, name, organization_id ) )')
    .eq('id', teamId)
    .single();

  if (!team) {
    return (
      <div className="admin-page">
        <Nav />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>Team not found.</p>
        </div>
      </div>
    );
  }

  const division = team.divisions as any;
  const season = division?.seasons as any;
  const organizationId = season?.organization_id;

  const memberships = await getCurrentUserMemberships();
  const hasAccess = memberships.some(
    (m) => m.organizationId === organizationId && (m.roles.includes('admin') || m.permissions.includes('manage_divisions'))
  );

  if (!hasAccess) {
    return (
      <div className="admin-page">
        <Nav />
        <AdminNav active="/admin/teams" />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>You do not have permission to view this team.</p>
        </div>
      </div>
    );
  }

  const { data: registrationRows } = await supabase
    .from('registrations')
    .select('id, person_id, jersey_number, status, people ( first_name, last_name )')
    .eq('team_id', teamId)
    .eq('registration_type', 'player')
    .order('created_at', { ascending: true });

  const players = (registrationRows ?? []).map((r: any) => ({
    registrationId: r.id,
    personId: r.person_id,
    firstName: r.people.first_name,
    lastName: r.people.last_name,
    jerseyNumber: r.jersey_number as string | null,
    status: r.status as string,
  }));

  const staffResult = await getTeamStaff(organizationId, teamId);
  const staff = Array.isArray(staffResult) ? staffResult : [];

  const membersResult = await getOrgMembers(organizationId);
  const orgMembers = Array.isArray(membersResult) ? membersResult : [];

  return (
    <div className="admin-page">
      <Nav />
      <AdminNav active="/admin/teams" />
      <div className="admin-header">
        <h1>{team.name}</h1>
        <p>
          <Link href="/admin/teams" style={{ color: 'var(--green-dark)' }}>
            ← All teams
          </Link>{' '}
          — {division?.name} · {season?.name}
        </p>
      </div>
      <div className="admin-body">
        <TeamRoster
          organizationId={organizationId}
          teamId={teamId}
          initialPlayers={players}
          initialStaff={staff}
          orgMembers={orgMembers}
        />
      </div>
    </div>
  );
}
