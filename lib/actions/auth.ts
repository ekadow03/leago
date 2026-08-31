'use server';

// lib/actions/auth.ts

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
