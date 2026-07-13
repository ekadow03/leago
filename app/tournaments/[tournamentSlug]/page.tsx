// app/tournaments/[tournamentSlug]/page.tsx
import { createClient } from '@/lib/supabase/server';
import TournamentPublic from './tournament-public';
import Nav from '@/components/nav';

export default async function PublicTournamentPage({
  params,
}: {
  params: Promise<{ tournamentSlug: string }>;
}) {
  const { tournamentSlug } = await params;
  const supabase = await createClient();

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, description, location, start_date, end_date, entry_fee_cents, status, organizations ( name )')
    .eq('slug', tournamentSlug)
    .single();

  if (!tournament) {
    return (
      <div>
        <Nav />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>Tournament not found.</p>
        </div>
      </div>
    );
  }

  const { data: teams } = await supabase
    .from('tournament_teams')
    .select('id, team_name, status')
    .eq('tournament_id', tournament.id)
    .eq('status', 'confirmed');

  const { data: matches } = await supabase
    .from('tournament_matches')
    .select('id, round, match_number, team1_id, team2_id, winner_team_id, score_team1, score_team2, status')
    .eq('tournament_id', tournament.id)
    .order('round', { ascending: true })
    .order('match_number', { ascending: true });

  return (
    <div>
      <Nav />
      <div className="hero-band" style={{ paddingBottom: 56 }}>
        <p className="hero-eyebrow">{(tournament.organizations as any).name}</p>
        <h1 className="hero-title">{tournament.name}</h1>
        {tournament.location && <p className="hero-subtitle">{tournament.location}</p>}
      </div>
      <div className="schedule-body">
        <TournamentPublic tournament={tournament as any} teams={teams ?? []} matches={matches ?? []} />
      </div>
    </div>
  );
}
