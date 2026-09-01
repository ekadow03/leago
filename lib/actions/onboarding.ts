'use server';

// lib/actions/onboarding.ts
//
// Returns { error } instead of throwing on failure. Next.js redacts the
// message of any Error thrown across the Server Action boundary in a
// production build (you're left with a generic "Server Components render"
// message and a digest, unless you dig through server logs) — returning a
// plain object keeps the real message visible to the client, same pattern
// already used in lib/actions/auth.ts. The whole body is wrapped in a
// try/catch too, not just the expected failure paths — an unanticipated
// throw (e.g. a missing env var breaking createAdminClient()) would
// otherwise still escape uncaught and get redacted the same as before.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface CreateLeagueInput {
  name: string;
  slug: string;
}

type CreateLeagueResult = { organizationId: string; slug: string } | { error: string };

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function createLeagueOrganization(input: CreateLeagueInput): Promise<CreateLeagueResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'You must be logged in to create a league.' };
    }

    const { data: person } = await supabase
      .from('people')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (!person) {
      return { error: 'No profile found for your account.' };
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
        return { error: 'That league URL is already taken — try a different name.' };
      }
      return { error: `Failed to create league: ${orgError?.message}` };
    }

    const { error: memberError } = await admin.from('organization_members').insert({
      organization_id: org.id,
      person_id: person.id,
      role: 'admin',
    });

    if (memberError) {
      await admin.from('organizations').delete().eq('id', org.id);
      return { error: `Failed to set you up as admin: ${memberError.message}` };
    }

    return { organizationId: org.id, slug: org.slug };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
