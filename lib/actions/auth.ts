'use server';

// lib/actions/auth.ts

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ensurePersonRecord } from '@/lib/people';

interface SignUpInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export async function signUp(input: SignUpInput): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      // Stashed in auth.users.user_metadata so the name typed here
      // survives even if the people-row insert below can't run yet (see
      // lib/people.ts) — every later getUser()/session carries it
      // regardless of confirmation state.
      data: {
        first_name: input.firstName,
        last_name: input.lastName,
      },
    },
  });

  if (authError) {
    return { error: authError.message };
  }

  if (!authData.user) {
    return { error: 'Sign up succeeded but no user was returned. Please try logging in.' };
  }

  // No session means email confirmation is required — signUp() just ran
  // unauthenticated, so RLS would silently block the insert below (see
  // 0005_people_self_insert.sql: the insert policy requires
  // auth_user_id = auth.uid(), and auth.uid() is null with no session).
  // Skip it here rather than let it fail — the people row gets created
  // once they actually authenticate, by ensurePersonRecord() in the
  // /auth/callback route (or the next logIn(), as a second safety net).
  if (!authData.session) {
    return {};
  }

  const { error: peopleError } = await supabase.from('people').insert({
    auth_user_id: authData.user.id,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
  });

  if (peopleError) {
    return {
      error: `Account created but profile setup failed: ${peopleError.message}. Contact support.`,
    };
  }

  return {};
}

export async function logIn(input: { email: string; password: string }): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) {
    return { error: error.message };
  }

  // Self-heals an account stuck with an auth user but no linked people
  // row (see lib/people.ts) — cheap no-op check on every login, and the
  // only way an already-broken account (created before this fix, or hit
  // by the email-confirmation gap) gets repaired without manual SQL.
  if (data.user) {
    await ensurePersonRecord(supabase, data.user);
  }

  return {};
}

export async function logOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
