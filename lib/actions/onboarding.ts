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
import { revalidatePath } from 'next/cache';

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

    const { data: person, error: personError } = await supabase
      .from('people')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (!person) {
      // Logged server-side (Vercel function logs) so a "no profile
      // found" report is actually diagnosable instead of guessed at —
      // this specific error has previously turned out to be caused by a
      // misconfigured NEXT_PUBLIC_SUPABASE_URL rather than a genuinely
      // missing row, and the real Postgrest error tells you which.
      console.error('[createLeagueOrganization] people lookup failed', {
        authUserId: user.id,
        email: user.email,
        error: personError,
      });
      // TEMPORARY: include the raw Postgrest error in the message shown
      // to the user so it can be diagnosed without digging through
      // Vercel's log viewer. Remove once the underlying issue is found.
      return {
        error: `No profile found for your account. [debug: ${JSON.stringify({
          authUserId: user.id,
          email: user.email,
          error: personError,
        })}]`,
      };
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

    // Every /admin/* page resolves "the" org to work in from
    // getCurrentUserMemberships(), and the Router Cache can otherwise
    // keep serving a stale /admin render from before this org existed —
    // revalidate server-side so the very next navigation there sees it.
    revalidatePath('/admin');

    return { organizationId: org.id, slug: org.slug };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
