'use server';

// lib/actions/draft.ts
// Draft session lifecycle. Every mutation here is admin-only — coaches and
// spectators watch via realtime subscriptions on the client, but only an
// admin's click actually calls these actions, matching Evan's requirement
// that the admin/league rep places every pick.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';
import { createClient } from '@/lib/supabase/server';
import { getCurrentPick } from '@/lib/draft-logic';

interface StartDraftInput {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  teamOrder: string[];
  totalRounds?: number;
}

export async function startDraftSession(input: StartDraftInput): Promise<{ id: string }> {
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can start a draft.');
  }
  if (input.teamOrder.length === 0) {
    throw new Error('Draft needs at least one team in the order.');
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('draft_sessions')
    .insert({
      organization_id: input.organizationId,
      season_id: input.seasonId,
      division_id: input.divisionId,
      team_order: input.teamOrder,
      total_rounds: input.totalRounds ?? null,
      status: 'live',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to start draft: ${error?.message}`);
  }

  return { id: data.id };
}

interface MakePickInput {
  draftSessionId: string;
  personId: string;
}

export async function makeDraftPick(input: MakePickInput): Promise<{ pickNumber: number }> {
  const admin = createAdminClient();

  const { data: session, error: sessionError } = await admin
    .from('draft_sessions')
    .select('id, organization_id, season_id, team_order, current_pick_index, total_rounds, status')
    .eq('id', input.draftSessionId)
    .single();

  if (sessionError || !session) {
    throw new Error('Draft session not found.');
  }

  const isAdmin = await requireOrgAdmin(session.organization_id);
  if (!isAdmin) {
    throw new Error('Only an organization admin can make a pick.');
  }

  if (session.status !== 'live') {
    throw new Error(`Draft is ${session.status}, not live.`);
  }

  const pick = getCurrentPick(session.team_order, session.current_pick_index, session.total_rounds);
  if (!pick) {
    throw new Error('Draft is already complete.');
  }

  const { data: existingPick } = await admin
    .from('draft_picks')
    .select('id')
    .eq('draft_session_id', input.draftSessionId)
    .eq('person_id', input.personId)
    .maybeSingle();

  if (existingPick) {
    throw new Error('This player has already been drafted in this session.');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: adminPerson } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', user!.id)
    .single();

  const pickNumber = session.current_pick_index + 1;

  const { error: pickError } = await admin.from('draft_picks').insert({
    draft_session_id: input.draftSessionId,
    pick_number: pickNumber,
    team_id: pick.teamId,
    person_id: input.personId,
    picked_by_person_id: adminPerson?.id ?? null,
  });

  if (pickError) {
    throw new Error(`Failed to record pick: ${pickError.message}`);
  }

  await admin
    .from('registrations')
    .update({ team_id: pick.teamId })
    .eq('person_id', input.personId)
    .eq('season_id', session.season_id)
    .eq('registration_type', 'player');

  const nextIndex = session.current_pick_index + 1;
  const isComplete =
    getCurrentPick(session.team_order, nextIndex, session.total_rounds) === null;

  await admin
    .from('draft_sessions')
    .update({
      current_pick_index: nextIndex,
      status: isComplete ? 'complete' : 'live',
    })
    .eq('id', input.draftSessionId);

  return { pickNumber };
}

export async function undoLastPick(draftSessionId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: session } = await admin
    .from('draft_sessions')
    .select('organization_id, season_id, current_pick_index')
    .eq('id', draftSessionId)
    .single();

  if (!session) throw new Error('Draft session not found.');

  const isAdmin = await requireOrgAdmin(session.organization_id);
  if (!isAdmin) throw new Error('Only an organization admin can undo a pick.');

  if (session.current_pick_index === 0) {
    throw new Error('No picks to undo.');
  }

  const { data: lastPick } = await admin
    .from('draft_picks')
    .select('id, person_id')
    .eq('draft_session_id', draftSessionId)
    .eq('pick_number', session.current_pick_index)
    .single();

  if (!lastPick) throw new Error('Could not find the last pick to undo.');

  await admin.from('draft_picks').delete().eq('id', lastPick.id);

  await admin
    .from('registrations')
    .update({ team_id: null })
    .eq('person_id', lastPick.person_id)
    .eq('season_id', session.season_id)
    .eq('registration_type', 'player');

  await admin
    .from('draft_sessions')
    .update({ current_pick_index: session.current_pick_index - 1, status: 'live' })
    .eq('id', draftSessionId);
}