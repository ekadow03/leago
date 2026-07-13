'use server';

// lib/actions/tournaments.ts

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';
import { stripe } from '@/lib/stripe';

// ============================================================================
// TOURNAMENT CRUD (admin)
// ============================================================================

interface CreateTournamentInput {
  organizationId: string;
  name: string;
  slug: string;
  description?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  entryFeeCents: number;
}

export async function createTournament(input: CreateTournamentInput): Promise<{ id: string }> {
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) throw new Error('Only an organization admin can create a tournament.');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('tournaments')
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      location: input.location ?? null,
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      entry_fee_cents: input.entryFeeCents,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`Failed to create tournament: ${error?.message}`);
  return { id: data.id };
}

export async function setTournamentStatus(
  organizationId: string,
  tournamentId: string,
  status: 'draft' | 'registration_open' | 'registration_closed' | 'in_progress' | 'complete'
): Promise<void> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) throw new Error('Only an organization admin can change tournament status.');

  const admin = createAdminClient();
  const { error } = await admin.from('tournaments').update({ status }).eq('id', tournamentId);
  if (error) throw new Error(`Failed to update status: ${error.message}`);
}

// ============================================================================
// EXTERNAL TEAM REGISTRATION (public — no auth required)
// ============================================================================

interface RegisterTeamInput {
  tournamentId: string;
  teamName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
}

export async function registerTournamentTeam(
  input: RegisterTeamInput
): Promise<{ teamId: string; clientSecret: string }> {
  const admin = createAdminClient();

  const { data: tournament, error: tError } = await admin
    .from('tournaments')
    .select('id, organization_id, entry_fee_cents, status, organizations ( stripe_connect_account_id )')
    .eq('id', input.tournamentId)
    .single();

  if (tError || !tournament) throw new Error('Tournament not found.');
  if (tournament.status !== 'registration_open') {
    throw new Error('Registration is not currently open for this tournament.');
  }

  const org = tournament.organizations as any;
  const amountCents = tournament.entry_fee_cents;

  if (amountCents === 0) {
    const { data: team, error } = await admin
      .from('tournament_teams')
      .insert({
        tournament_id: input.tournamentId,
        team_name: input.teamName,
        contact_name: input.contactName,
        contact_email: input.contactEmail,
        contact_phone: input.contactPhone ?? null,
        amount_cents: 0,
        payment_status: 'paid',
        status: 'confirmed',
      })
      .select('id')
      .single();

    if (error || !team) throw new Error(`Failed to register team: ${error?.message}`);
    return { teamId: team.id, clientSecret: '' };
  }

  if (!org?.stripe_connect_account_id) {
    throw new Error('This tournament\'s host has not completed payment setup.');
  }

  const platformFeeCents = Math.round(amountCents * 0.03);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    application_fee_amount: platformFeeCents,
    transfer_data: { destination: org.stripe_connect_account_id },
    metadata: { tournament_id: input.tournamentId, team_name: input.teamName },
  });

  const { data: team, error } = await admin
    .from('tournament_teams')
    .insert({
      tournament_id: input.tournamentId,
      team_name: input.teamName,
      contact_name: input.contactName,
      contact_email: input.contactEmail,
      contact_phone: input.contactPhone ?? null,
      amount_cents: amountCents,
      payment_status: 'processing',
      status: 'pending',
      stripe_payment_intent_id: paymentIntent.id,
    })
    .select('id')
    .single();

  if (error || !team) {
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
    throw new Error(`Failed to register team: ${error?.message}`);
  }

  return { teamId: team.id, clientSecret: paymentIntent.client_secret! };
}

// ============================================================================
// BRACKET GENERATION + ADVANCEMENT (admin)
// ============================================================================

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function generateBracket(organizationId: string, tournamentId: string): Promise<void> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) throw new Error('Only an organization admin can generate the bracket.');

  const admin = createAdminClient();

  const { data: tournament } = await admin
    .from('tournaments')
    .select('entry_fee_cents')
    .eq('id', tournamentId)
    .single();

  const { data: teams } = await admin
    .from('tournament_teams')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'confirmed');

  const confirmedTeams = (teams ?? []).filter(Boolean);
  if (confirmedTeams.length < 2) {
    throw new Error('Need at least 2 confirmed teams to generate a bracket.');
  }

  await admin.from('tournament_matches').delete().eq('tournament_id', tournamentId);

  const shuffled = shuffle(confirmedTeams.map((t) => t.id));
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(shuffled.length)));
  const slots: (string | null)[] = [...shuffled, ...Array(bracketSize - shuffled.length).fill(null)];

  const totalRounds = Math.log2(bracketSize);

  const round1Matches: any[] = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    const team1 = slots[i * 2];
    const team2 = slots[i * 2 + 1];
    const isBye = !team1 || !team2;
    round1Matches.push({
      tournament_id: tournamentId,
      round: 1,
      match_number: i + 1,
      team1_id: team1,
      team2_id: team2,
      winner_team_id: isBye ? team1 ?? team2 : null,
      status: isBye ? 'complete' : 'scheduled',
    });
  }

  const laterRoundMatches: any[] = [];
  for (let round = 2; round <= totalRounds; round++) {
    const matchesInRound = bracketSize / Math.pow(2, round);
    for (let i = 0; i < matchesInRound; i++) {
      laterRoundMatches.push({
        tournament_id: tournamentId,
        round,
        match_number: i + 1,
        status: 'scheduled',
      });
    }
  }

  const { error: insertError } = await admin
    .from('tournament_matches')
    .insert([...round1Matches, ...laterRoundMatches]);

  if (insertError) throw new Error(`Failed to generate bracket: ${insertError.message}`);

  for (const m of round1Matches) {
    if (m.winner_team_id) {
      await advanceWinnerInternal(admin, tournamentId, 1, m.match_number, m.winner_team_id, totalRounds);
    }
  }

  await admin.from('tournaments').update({ status: 'in_progress' }).eq('id', tournamentId);
}

async function advanceWinnerInternal(
  admin: ReturnType<typeof createAdminClient>,
  tournamentId: string,
  fromRound: number,
  fromMatchNumber: number,
  winnerId: string,
  totalRounds: number
) {
  if (fromRound >= totalRounds) return;

  const nextRound = fromRound + 1;
  const nextMatchNumber = Math.ceil(fromMatchNumber / 2);
  const isTeam1Slot = fromMatchNumber % 2 === 1;

  const { data: nextMatch } = await admin
    .from('tournament_matches')
    .select('id, team1_id, team2_id')
    .eq('tournament_id', tournamentId)
    .eq('round', nextRound)
    .eq('match_number', nextMatchNumber)
    .single();

  if (!nextMatch) return;

  await admin
    .from('tournament_matches')
    .update(isTeam1Slot ? { team1_id: winnerId } : { team2_id: winnerId })
    .eq('id', nextMatch.id);
}

export async function recordMatchResult(
  organizationId: string,
  matchId: string,
  scoreTeam1: number,
  scoreTeam2: number
): Promise<void> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) throw new Error('Only an organization admin can record match results.');

  const admin = createAdminClient();

  const { data: match } = await admin
    .from('tournament_matches')
    .select('id, tournament_id, round, match_number, team1_id, team2_id')
    .eq('id', matchId)
    .single();

  if (!match) throw new Error('Match not found.');
  if (!match.team1_id || !match.team2_id) {
    throw new Error('Both teams must be set before recording a result.');
  }
  if (scoreTeam1 === scoreTeam2) {
    throw new Error('Tournament matches need a winner — scores cannot tie.');
  }

  const winnerId = scoreTeam1 > scoreTeam2 ? match.team1_id : match.team2_id;

  await admin
    .from('tournament_matches')
    .update({
      score_team1: scoreTeam1,
      score_team2: scoreTeam2,
      winner_team_id: winnerId,
      status: 'complete',
    })
    .eq('id', matchId);

  const { data: allMatches } = await admin
    .from('tournament_matches')
    .select('round')
    .eq('tournament_id', match.tournament_id);

  const totalRounds = Math.max(...(allMatches ?? []).map((m) => m.round));

  await advanceWinnerInternal(admin, match.tournament_id, match.round, match.match_number, winnerId, totalRounds);

  if (match.round === totalRounds) {
    await admin.from('tournaments').update({ status: 'complete' }).eq('id', match.tournament_id);
  }
}