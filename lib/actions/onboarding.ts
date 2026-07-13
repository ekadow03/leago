'use server';

// lib/actions/onboarding.ts
//
// Self-serve league sign-up. Until now every organization was created
// manually via SQL (seed_test_league.sql) — this is the first real
// "create your own league" flow. Organizations.insert is normally
// restricted to platform admins only (0001_foundation.sql), so this
// action uses the admin client to bypass that after doing its own
// authorization check (must be logged in) — same pattern as every other
// admin-client action in this codebase.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface CreateLeagueInput {
  name: string;
  slug: string;
}

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function createLeagueOrganization(
  input: CreateLeagueInput
): Promise<{ organizationId: string; slug: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be logged in to create a league.');
  }

  const { data: person } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!person) {
    throw new Error('No profile found for your account.');
  }

  const admin = createAdminClient();

  const slug = slugify(input.slug || input.name);

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({
      name: input.name,
      slug,
      subscription_tier: 'trial',
      subscription_status: 'trialing',
    })
    .select('id, slug')
    .single();

  if (orgError || !org) {
    if (orgError?.code === '23505') {
      throw new Error('That league URL is already taken — try a different name.');
    }
    throw new Error(`Failed to create league: ${orgError?.message}`);
  }

  const { error: memberError } = await admin.from('organization_members').insert({
    organization_id: org.id,
    person_id: person.id,
    role: 'admin',
  });

  if (memberError) {
    await admin.from('organizations').delete().eq('id', org.id);
    throw new Error(`Failed to set you up as admin: ${memberError.message}`);
  }

  return { organizationId: org.id, slug: org.slug };
}