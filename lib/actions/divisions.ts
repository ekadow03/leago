'use server';

// lib/actions/divisions.ts

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

export async function createDivision(input: CreateDivisionInput): Promise<{ id: string }> {
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can create a division.');
  }

  if (!input.name.trim()) {
    throw new Error('Division name is required.');
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
    throw new Error('Season not found for this organization.');
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
    throw new Error(`Failed to create division: ${error?.message}`);
  }

  return { id: data.id };
}
