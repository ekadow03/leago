// lib/people.ts
//
// Every server action/page in this app assumes a logged-in auth user has
// a linked `people` row — org membership, registrations, everything keys
// off people.id, never auth.users.id directly. That row is normally
// created at sign-up (lib/actions/auth.ts), but when the Supabase project
// requires email confirmation, auth.signUp() returns with NO session yet
// (the user isn't authenticated until they click the confirmation link).
// The immediate insert into `people` right after signUp() then runs
// unauthenticated, RLS blocks it (auth.uid() is null — see
// 0005_people_self_insert.sql's "auth_user_id = auth.uid()" check), and
// the row silently never gets created — the account is left stuck with
// an auth.users row but no people row, which surfaces later as
// "No profile found for your account." on every action that depends on
// one (creating a league, registering, etc).
//
// This is the self-healing fallback: call it after any point where we
// know the user is genuinely authenticated (email-confirmation callback,
// every login) to create the missing row if one doesn't already exist.

import type { SupabaseClient, User } from '@supabase/supabase-js';

export async function ensurePersonRecord(supabase: SupabaseClient, user: User): Promise<void> {
  const { data: existing } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (existing) return;

  // first_name/last_name are stashed in user_metadata at sign-up time
  // (see the `data:` option in lib/actions/auth.ts's signUp()) precisely
  // so they survive to this point even if the row couldn't be created
  // immediately. An account that predates that change (or that never
  // went through this app's signup form) won't have them — fall back to
  // placeholders rather than fail outright; the person can be renamed
  // later, but a missing profile blocks everything.
  const metadata = (user.user_metadata ?? {}) as { first_name?: string; last_name?: string };

  await supabase.from('people').insert({
    auth_user_id: user.id,
    first_name: metadata.first_name?.trim() || 'New',
    last_name: metadata.last_name?.trim() || 'Member',
    email: user.email ?? null,
  });
}
