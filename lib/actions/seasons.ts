'use server';

// lib/actions/seasons.ts

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

interface CreateSeasonInput {
  organizationId: string;
  name: string;
  registrationOpenAt?: string;
  registrationCloseAt?: string;
}

export async function createSeason(input: CreateSeasonInput): Promise<{ id: string }> {
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can create a season.');
  }

  if (!input.name.trim()) {
    throw new Error('Season name is required.');
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
    throw new Error(`Failed to create season: ${error?.message}`);
  }

  return { id: data.id };
}
