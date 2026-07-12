'use server';

// lib/actions/auth.ts
//
// Sign-up creates BOTH the Supabase auth user AND the corresponding `people`
// row in one action. This matters: every other part of the schema (RLS
// policies, org-context.ts, createRegistration) assumes every authenticated
// user has a matching people row keyed by auth_user_id — an auth user with
// no people row would be able to log in but fail everywhere else in a
// confusing way. Keeping creation atomic here avoids that class of bug.

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

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
    },
  });

  if (authError) {
    return { error: authError.message };
  }

  if (!authData.user) {
    return { error: 'Sign up succeeded but no user was returned. Please try logging in.' };
  }

  // Create the linked people row. If email confirmation is required, this
  // still runs now — the auth user already exists at this point even
  // before they click the confirmation link, and we want the people row
  // ready by the time they're able to log in.
  const { error: peopleError } = await supabase.from('people').insert({
    auth_user_id: authData.user.id,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
  });

  if (peopleError) {
    // Don't leave a half-created account in a silently broken state —
    // surface this clearly rather than letting them proceed to a login
    // that will fail confusingly later in org-context.ts.
    return {
      error: `Account created but profile setup failed: ${peopleError.message}. Contact support.`,
    };
  }

  return {};
}

export async function logIn(input: { email: string; password: string }): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) {
    return { error: error.message };
  }

  return {};
}

export async function logOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
