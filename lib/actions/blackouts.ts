'use server';

// lib/actions/blackouts.ts
//
// Season-scoped dates/times that generateSeasonSchedule() must not place
// games into — see migration 0017 for the three recurrence "kinds" this
// supports (date / weekly / daily) and how field_name scoping works.
//
// Returns { error } instead of throwing, and wraps the whole body in a
// try/catch — see the comment in lib/actions/onboarding.ts for why.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';

interface CreateBlackoutInput {
  organizationId: string;
  seasonId: string;
  kind: 'date' | 'weekly' | 'daily';
  fieldName?: string | null;
  blackoutDate?: string; // "2026-11-26" — required for kind='date'
  dayOfWeek?: number; // 0=Sun..6=Sat — required for kind='weekly'
  startTime?: string; // "18:00" — omit together with endTime for a full-day/full-occurrence block
  endTime?: string;
  label?: string;
}

type CreateBlackoutResult = { id: string } | { error: string };

export async function createBlackout(input: CreateBlackoutInput): Promise<CreateBlackoutResult> {
  try {
    const authorized = await requireOrgPermission(input.organizationId, 'manage_schedule');
    if (!authorized) {
      return { error: 'You do not have permission to add a blackout.' };
    }

    if (input.kind === 'date' && !input.blackoutDate) {
      return { error: 'Pick a date for a specific-date blackout.' };
    }
    if (input.kind === 'weekly' && (input.dayOfWeek === undefined || input.dayOfWeek === null)) {
      return { error: 'Pick a day of the week for a weekly blackout.' };
    }
    if ((input.startTime && !input.endTime) || (!input.startTime && input.endTime)) {
      return { error: 'Set both a start and end time, or leave both blank for a full day.' };
    }
    if (input.startTime && input.endTime && input.startTime >= input.endTime) {
      return { error: 'End time must be after start time.' };
    }

    const admin = createAdminClient();

    // Defense in depth: requireOrgPermission only checked the caller-supplied
    // organizationId, which the client controls — confirm the season
    // being written to actually belongs to that org before inserting,
    // since the admin client bypasses RLS.
    const { data: season } = await admin
      .from('seasons')
      .select('id, organization_id')
      .eq('id', input.seasonId)
      .single();

    if (!season || season.organization_id !== input.organizationId) {
      return { error: 'Season not found for this organization.' };
    }

    const { data, error } = await admin
      .from('blackouts')
      .insert({
        organization_id: input.organizationId,
        season_id: input.seasonId,
        kind: input.kind,
        field_name: input.fieldName || null,
        blackout_date: input.kind === 'date' ? input.blackoutDate : null,
        day_of_week: input.kind === 'weekly' ? input.dayOfWeek : null,
        start_time: input.startTime || null,
        end_time: input.endTime || null,
        label: input.label?.trim() || null,
      })
      .select('id')
      .single();

    if (error || !data) {
      return { error: `Failed to add blackout: ${error?.message}` };
    }

    return { id: data.id };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}

type DeleteBlackoutResult = { ok: true } | { error: string };

export async function deleteBlackout(organizationId: string, blackoutId: string): Promise<DeleteBlackoutResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_schedule');
    if (!authorized) {
      return { error: 'You do not have permission to remove a blackout.' };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('blackouts')
      .delete()
      .eq('id', blackoutId)
      .eq('organization_id', organizationId);

    if (error) {
      return { error: `Failed to remove blackout: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
