'use server';

// lib/actions/events.ts
//
// All four actions return { error } instead of throwing — see the comment
// in lib/actions/onboarding.ts for why (Next.js redacts thrown Server
// Action error messages in production builds).

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

interface CreateEventInput {
  organizationId: string;
  seasonId?: string;
  divisionId?: string;
  type: 'game' | 'practice' | 'volunteer_shift' | 'league_event';
  title: string;
  location?: string;
  startTime: string;
  endTime?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  notes?: string;
}

type CreateEventResult = { id: string } | { error: string };

export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) {
    return { error: 'Only an organization admin can create schedule events.' };
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('events')
    .insert({
      organization_id: input.organizationId,
      season_id: input.seasonId ?? null,
      division_id: input.divisionId ?? null,
      type: input.type,
      title: input.title,
      location: input.location ?? null,
      start_time: input.startTime,
      end_time: input.endTime ?? null,
      home_team_id: input.homeTeamId ?? null,
      away_team_id: input.awayTeamId ?? null,
      notes: input.notes ?? null,
      status: 'draft',
    })
    .select('id')
    .single();

  if (error || !data) {
    return { error: `Failed to create event: ${error?.message}` };
  }

  return { id: data.id };
}

type SetEventStatusResult = { ok: true } | { error: string };

export async function setEventStatus(
  organizationId: string,
  eventId: string,
  status: 'draft' | 'published' | 'canceled'
): Promise<SetEventStatusResult> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    return { error: 'Only an organization admin can change event status.' };
  }

  const admin = createAdminClient();
  const { error } = await admin.from('events').update({ status }).eq('id', eventId);

  if (error) {
    return { error: `Failed to update event status: ${error.message}` };
  }

  return { ok: true };
}

type PublishAllResult = { count: number } | { error: string };

export async function publishAllDraftEvents(organizationId: string, seasonId: string): Promise<PublishAllResult> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    return { error: 'Only an organization admin can publish the schedule.' };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('events')
    .update({ status: 'published' })
    .eq('organization_id', organizationId)
    .eq('season_id', seasonId)
    .eq('status', 'draft')
    .select('id');

  if (error) {
    return { error: `Failed to publish schedule: ${error.message}` };
  }

  return { count: data?.length ?? 0 };
}

type DeleteEventResult = { ok: true } | { error: string };

export async function deleteEvent(organizationId: string, eventId: string): Promise<DeleteEventResult> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    return { error: 'Only an organization admin can delete events.' };
  }

  const admin = createAdminClient();
  const { error } = await admin.from('events').delete().eq('id', eventId);

  if (error) {
    return { error: `Failed to delete event: ${error.message}` };
  }

  return { ok: true };
}
