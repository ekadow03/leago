'use server';

// lib/actions/seasons.ts
//
// Returns { error } instead of throwing — see the comment in
// lib/actions/onboarding.ts for why (Next.js redacts thrown Server Action
// error messages in production builds).

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
}
