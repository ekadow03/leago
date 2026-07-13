'use server';

// lib/actions/events.ts
// Schedule management — creating games/practices/events and publishing them.
// All mutations are admin-only; reading is handled directly via RLS in the
// pages (public sees published only, org members see everything).

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

export async function createEvent(input: CreateEventInput): Promise<{ id: string }> {
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can create schedule events.');
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
    throw new Error(`Failed to create event: ${error?.message}`);
  }

  return { id: data.id };
}

export async function setEventStatus(
  organizationId: string,
  eventId: string,
  status: 'draft' | 'published' | 'canceled'
): Promise<void> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can change event status.');
  }

  const admin = createAdminClient();
  const { error } = await admin.from('events').update({ status }).eq('id', eventId);

  if (error) {
    throw new Error(`Failed to update event status: ${error.message}`);
  }
}

export async function publishAllDraftEvents(organizationId: string, seasonId: string): Promise<{ count: number }> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can publish the schedule.');
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
    throw new Error(`Failed to publish schedule: ${error.message}`);
  }

  return { count: data?.length ?? 0 };
}

export async function deleteEvent(organizationId: string, eventId: string): Promise<void> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can delete events.');
  }

  const admin = createAdminClient();
  const { error } = await admin.from('events').delete().eq('id', eventId);

  if (error) {
    throw new Error(`Failed to delete event: ${error.message}`);
  }
}