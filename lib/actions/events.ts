'use server';

// lib/actions/events.ts
//
// All actions return { error } instead of throwing, and wrap their
// whole body in a try/catch — see the comment in lib/actions/onboarding.ts
// for why (Next.js redacts thrown Server Action error messages in
// production builds, and an unanticipated exception needs catching too,
// not just the expected ones).

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';
import { findCoachConflictsForEvent, type CoachConflict } from '@/lib/scheduling-conflicts';

// No gameDurationMinutes input exists at this single-event granularity
// (that's an auto-schedule.ts-only concept) — used only to give an
// event with no end_time a reasonable window to check for coach
// conflicts against, same idea as auto-schedule.ts's fallback.
const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

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
  // Set after the caller has shown the user the conflicts from a first
  // call (see the { conflicts } branch below) and they chose to proceed
  // anyway — e.g. a co-coach genuinely covering two teams at once.
  allowConflicts?: boolean;
}

type CreateEventResult = { id: string } | { error: string } | { conflicts: CoachConflict[] };

function unexpectedError(err: unknown): { error: string } {
  return { error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.' };
}

export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  try {
    const authorized = await requireOrgPermission(input.organizationId, 'manage_schedule');
    if (!authorized) {
      return { error: 'You do not have permission to create schedule events.' };
    }

    const admin = createAdminClient();

    if (!input.allowConflicts && (input.homeTeamId || input.awayTeamId)) {
      const conflicts = await findCoachConflictsForEvent(admin, input.organizationId, {
        startTime: input.startTime,
        endTime: input.endTime ?? null,
        homeTeamId: input.homeTeamId ?? null,
        awayTeamId: input.awayTeamId ?? null,
        fallbackDurationMs: DEFAULT_EVENT_DURATION_MS,
      });
      if (conflicts.length > 0) {
        return { conflicts };
      }
    }

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
  } catch (err) {
    return unexpectedError(err);
  }
}

type SetEventStatusResult = { ok: true } | { error: string };

export async function setEventStatus(
  organizationId: string,
  eventId: string,
  status: 'draft' | 'published' | 'canceled'
): Promise<SetEventStatusResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_schedule');
    if (!authorized) {
      return { error: 'You do not have permission to change event status.' };
    }

    const admin = createAdminClient();
    const { error } = await admin.from('events').update({ status }).eq('id', eventId);

    if (error) {
      return { error: `Failed to update event status: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return unexpectedError(err);
  }
}

type PublishAllResult = { count: number } | { error: string };

export async function publishAllDraftEvents(organizationId: string, seasonId: string): Promise<PublishAllResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_schedule');
    if (!authorized) {
      return { error: 'You do not have permission to publish the schedule.' };
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
  } catch (err) {
    return unexpectedError(err);
  }
}

type DeleteEventResult = { ok: true } | { error: string };

export async function deleteEvent(organizationId: string, eventId: string): Promise<DeleteEventResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_schedule');
    if (!authorized) {
      return { error: 'You do not have permission to delete events.' };
    }

    const admin = createAdminClient();
    const { error } = await admin.from('events').delete().eq('id', eventId);

    if (error) {
      return { error: `Failed to delete event: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return unexpectedError(err);
  }
}

type DeleteEventsResult = { count: number } | { error: string };

/** Bulk delete — used by the schedule builder's multi-select "Delete
 * selected" action, and to clear a division's draft schedule before
 * regenerating it. Scoped to organizationId server-side (not just
 * trusted from the client) so a caller can't delete another org's
 * events by passing arbitrary ids. */
export async function deleteEvents(organizationId: string, eventIds: string[]): Promise<DeleteEventsResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_schedule');
    if (!authorized) {
      return { error: 'You do not have permission to delete events.' };
    }

    if (eventIds.length === 0) {
      return { count: 0 };
    }

    const admin = createAdminClient();
    const { error, data } = await admin
      .from('events')
      .delete()
      .eq('organization_id', organizationId)
      .in('id', eventIds)
      .select('id');

    if (error) {
      return { error: `Failed to delete events: ${error.message}` };
    }

    return { count: data?.length ?? 0 };
  } catch (err) {
    return unexpectedError(err);
  }
}

interface UpdateEventInput {
  organizationId: string;
  eventId: string;
  title?: string;
  location?: string | null;
  startTime?: string;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  weekNumber?: number | null;
  // See CreateEventInput.allowConflicts.
  allowConflicts?: boolean;
}

type UpdateEventResult = { ok: true } | { error: string } | { conflicts: CoachConflict[] };

/** Manual edit for an existing event — the generator and the single-add
 * form only ever create events, so this is the only way to change a
 * game's time, field, teams, or week label after the fact without
 * deleting and recreating it. Only fields actually provided are
 * changed. */
export async function updateEvent(input: UpdateEventInput): Promise<UpdateEventResult> {
  try {
    const authorized = await requireOrgPermission(input.organizationId, 'manage_schedule');
    if (!authorized) {
      return { error: 'You do not have permission to edit events.' };
    }

    const admin = createAdminClient();

    // A coach conflict check needs the event's full resulting
    // start_time/home/away — not just whichever fields this particular
    // edit touches — so read the current row and merge the patch onto it
    // before checking, rather than checking only what changed.
    if (!input.allowConflicts && (input.startTime !== undefined || input.homeTeamId !== undefined || input.awayTeamId !== undefined)) {
      const { data: current } = await admin
        .from('events')
        .select('start_time, end_time, home_team_id, away_team_id')
        .eq('id', input.eventId)
        .eq('organization_id', input.organizationId)
        .single();

      if (current) {
        const homeTeamId = input.homeTeamId !== undefined ? input.homeTeamId : current.home_team_id;
        const awayTeamId = input.awayTeamId !== undefined ? input.awayTeamId : current.away_team_id;
        const startTime = input.startTime !== undefined ? input.startTime : current.start_time;

        const conflicts = await findCoachConflictsForEvent(admin, input.organizationId, {
          excludeEventId: input.eventId,
          startTime,
          endTime: current.end_time,
          homeTeamId,
          awayTeamId,
          fallbackDurationMs: DEFAULT_EVENT_DURATION_MS,
        });
        if (conflicts.length > 0) {
          return { conflicts };
        }
      }
    }

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.location !== undefined) patch.location = input.location;
    if (input.startTime !== undefined) patch.start_time = input.startTime;
    if (input.homeTeamId !== undefined) patch.home_team_id = input.homeTeamId;
    if (input.awayTeamId !== undefined) patch.away_team_id = input.awayTeamId;
    if (input.weekNumber !== undefined) patch.week_number = input.weekNumber;

    if (Object.keys(patch).length === 0) {
      return { ok: true };
    }

    const { error } = await admin
      .from('events')
      .update(patch)
      .eq('id', input.eventId)
      .eq('organization_id', input.organizationId);

    if (error) {
      return { error: `Failed to update event: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return unexpectedError(err);
  }
}
