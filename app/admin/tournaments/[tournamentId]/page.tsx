// app/admin/tournaments/[tournamentId]/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import TournamentAdmin from './tournament-admin';

export default async function TournamentAdminPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/admin/tournaments/${tournamentId}`);
  }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, organization_id, name, slug, status, entry_fee_cents')
    .eq('id', tournamentId)
    .single();

  if (!tournament) {
    return <div style={{ padding: 40 }}>Tournament not found.</div>;
  }

  const memberships = await getCurrentUserMemberships();
  const isAdmin = memberships.some(
    (m) => m.organizationId === tournament.organization_id && m.roles.includes('admin')
  );

  if (!isAdmin) {
    return <div style={{ padding: 40 }}>You must be an organization admin to view this page.</div>;
  }

  const { data: teams } = await supabase
    .from('tournament_teams')
    .select('id, team_name, contact_name, contact_email, status, payment_status')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: true });

  const { data: matches } = await supabase
    .from('tournament_matches')
    .select('id, round, match_number, team1_id, team2_id, winner_team_id, score_team1, score_team2, status')
    .eq('tournament_id', tournamentId)
    .order('round', { ascending: true })
    .order('match_number', { ascending: true });

  return (
    <TournamentAdmin
      organizationId={tournament.organization_id}
      tournament={tournament}
      initialTeams={teams ?? []}
      initialMatches={matches ?? []}
    />
  );
}