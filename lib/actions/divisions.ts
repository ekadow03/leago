'use server';

// lib/actions/divisions.ts
//
// Returns { error } instead of throwing, and wraps the whole body in a
// try/catch — see the comment in lib/actions/onboarding.ts for why (Next.js
// redacts thrown Server Action error messages in production builds, and an
// unanticipated exception needs catching too, not just the expected ones).

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';

interface CreateDivisionInput {
  organizationId: string;
  seasonId: string;
  name: string;
  ageMin?: number;
  ageMax?: number;
  priceCents?: number;
}

type CreateDivisionResult = { id: string } | { error: string };

export async function createDivision(input: CreateDivisionInput): Promise<CreateDivisionResult> {
  try {
    const authorized = await requireOrgPermission(input.organizationId, 'manage_divisions');
    if (!authorized) {
      return { error: 'You do not have permission to create a division.' };
    }

    if (!input.name.trim()) {
      return { error: 'Division name is required.' };
    }

    const admin = createAdminClient();

    // Defense in depth: requireOrgPermission only checked the caller-supplied
    // organizationId, which the client controls — confirm the season being
    // written to actually belongs to that org before inserting, since the
    // admin client bypasses RLS.
    const { data: season } = await admin
      .from('seasons')
      .select('id, organization_id')
      .eq('id', input.seasonId)
      .single();

    if (!season || season.organization_id !== input.organizationId) {
      return { error: 'Season not found for this organization.' };
    }

    const { data, error } = await admin
      .from('divisions')
      .insert({
        season_id: input.seasonId,
        name: input.name.trim(),
        age_min: input.ageMin ?? null,
        age_max: input.ageMax ?? null,
        price_cents: input.priceCents ?? 0,
      })
      .select('id')
      .single();

    if (error || !data) {
      return { error: `Failed to create division: ${error?.message}` };
    }

    return { id: data.id };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}

type UpdatePriorityResult = { ok: true } | { error: string };

/** Advisory ranking only — see migration 0016. Lower number means this
 * division should have its schedule generated first when it shares a
 * field with other divisions in the same organization; does not itself
 * touch any events. */
export async function updateDivisionPriority(
  organizationId: string,
  divisionId: string,
  priority: number
): Promise<UpdatePriorityResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_divisions');
    if (!authorized) {
      return { error: 'You do not have permission to reorder divisions.' };
    }

    if (!Number.isFinite(priority)) {
      return { error: 'Priority must be a number.' };
    }

    const admin = createAdminClient();

    const { data: division } = await admin
      .from('divisions')
      .select('id, seasons ( organization_id )')
      .eq('id', divisionId)
      .single();

    const orgId = (division?.seasons as any)?.organization_id;
    if (!division || orgId !== organizationId) {
      return { error: 'Division not found for this organization.' };
    }

    const { error } = await admin
      .from('divisions')
      .update({ schedule_priority: priority })
      .eq('id', divisionId);

    if (error) {
      return { error: `Failed to update priority: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
