'use server';

// lib/actions/seasons.ts
//
// Returns { error } instead of throwing, and wraps the whole body in a
// try/catch — see the comment in lib/actions/onboarding.ts for why (Next.js
// redacts thrown Server Action error messages in production builds, and an
// unanticipated exception needs catching too, not just the expected ones).

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

interface CreateSeasonInput {
  organizationId: string;
  name: string;
  registrationOpenAt?: string;
  registrationCloseAt?: string;
}

type CreateSeasonResult = { id: string } | { error: string };

export async function createSeason(input: CreateSeasonInput): Promise<CreateSeasonResult> {
  try {
    const isAdmin = await requireOrgAdmin(input.organizationId);
    if (!isAdmin) {
      return { error: 'Only an organization admin can create a season.' };
    }

    if (!input.name.trim()) {
      return { error: 'Season name is required.' };
    }

    const admin = createAdminClient();

    const { data, error } = await admin
      .from('seasons')
      .insert({
        organization_id: input.organizationId,
        name: input.name.trim(),
        status: 'draft',
        registration_open_at: input.registrationOpenAt || null,
        registration_close_at: input.registrationCloseAt || null,
      })
      .select('id')
      .single();

    if (error || !data) {
      return { error: `Failed to create season: ${error?.message}` };
    }

    return { id: data.id };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}

type SetSeasonArchivedResult = { ok: true } | { error: string };

/** Archiving (and un-archiving) just flips seasons.status — 'archived' is
 * already a valid value in the schema's check constraint (migration
 * 0001), this just exposes it. Un-archiving goes back to 'draft' since
 * that's the only status anything in this app currently sets otherwise —
 * there's no registration_open/active/completed UI yet to restore to. */
export async function setSeasonArchived(
  organizationId: string,
  seasonId: string,
  archived: boolean
): Promise<SetSeasonArchivedResult> {
  try {
    const isAdmin = await requireOrgAdmin(organizationId);
    if (!isAdmin) {
      return { error: `Only an organization admin can ${archived ? 'archive' : 'unarchive'} a season.` };
    }

    const admin = createAdminClient();

    const { data: season } = await admin
      .from('seasons')
      .select('id, organization_id')
      .eq('id', seasonId)
      .single();

    if (!season || season.organization_id !== organizationId) {
      return { error: 'Season not found for this organization.' };
    }

    const { error } = await admin
      .from('seasons')
      .update({ status: archived ? 'archived' : 'draft' })
      .eq('id', seasonId);

    if (error) {
      return { error: `Failed to ${archived ? 'archive' : 'unarchive'} season: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}

type DeleteSeasonResult = { ok: true } | { error: string };

/** Hard delete — only allowed on a season with nothing real attached to
 * it yet (no registrations, no teams, no scheduled events). Every child
 * table cascades on season/division delete (divisions, teams,
 * evaluations/draft data, blackouts, field priorities, generation
 * settings), which is fine for an empty season but would silently
 * destroy registration/payment history and any already-scheduled or
 * published games for a real one — archiving is the safe path for those,
 * this is just for cleaning up a season created by mistake. */
export async function deleteSeason(organizationId: string, seasonId: string): Promise<DeleteSeasonResult> {
  try {
    const isAdmin = await requireOrgAdmin(organizationId);
    if (!isAdmin) {
      return { error: 'Only an organization admin can delete a season.' };
    }

    const admin = createAdminClient();

    const { data: season } = await admin
      .from('seasons')
      .select('id, organization_id')
      .eq('id', seasonId)
      .single();

    if (!season || season.organization_id !== organizationId) {
      return { error: 'Season not found for this organization.' };
    }

    const { data: divisions } = await admin.from('divisions').select('id').eq('season_id', seasonId);
    const divisionIds = (divisions ?? []).map((d) => d.id);

    const [registrationCheck, eventCheck] = await Promise.all([
      admin.from('registrations').select('id', { count: 'exact', head: true }).eq('season_id', seasonId),
      admin.from('events').select('id', { count: 'exact', head: true }).eq('season_id', seasonId),
    ]);

    let teamCount = 0;
    if (divisionIds.length > 0) {
      const { count } = await admin
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .in('division_id', divisionIds);
      teamCount = count ?? 0;
    }

    if ((registrationCheck.count ?? 0) > 0 || teamCount > 0 || (eventCheck.count ?? 0) > 0) {
      return {
        error:
          'This season has registrations, teams, or scheduled events attached to it — archive it instead to keep that history. Delete only works on an empty season.',
      };
    }

    const { error } = await admin.from('seasons').delete().eq('id', seasonId);

    if (error) {
      return { error: `Failed to delete season: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
