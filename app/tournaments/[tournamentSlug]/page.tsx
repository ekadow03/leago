// app/tournaments/[tournamentSlug]/page.tsx
//
// Public — no auth required. Matches the /tournaments/{slug} link shown
// on the admin page. Slug lookup isn't globally unique across orgs (only
// unique per-org in the schema) — fine for now with a single test org;
// worth revisiting with an org-prefixed URL if/when multiple leagues host
// tournaments with overlapping slugs.

import { createClient } from '@/lib/supabase/server';
import TournamentPublic from './tournament-public';

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
      <div style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'system-ui' }}>
        <p>Tournament not found.</p>
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
    <TournamentPublic
      tournament={tournament as any}
      teams={teams ?? []}
      matches={matches ?? []}
    />
  );
}