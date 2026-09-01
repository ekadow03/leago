'use server';

// lib/actions/divisions.ts
//
// Returns { error } instead of throwing — see the comment in
// lib/actions/onboarding.ts for why (Next.js redacts thrown Server Action
// error messages in production builds).

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

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
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) {
    return { error: 'Only an organization admin can create a division.' };
  }

  if (!input.name.trim()) {
    return { error: 'Division name is required.' };
  }

  const admin = createAdminClient();

  // Defense in depth: requireOrgAdmin only checked the caller-supplied
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
}
