// lib/supabase/server.ts
// Server-side Supabase client for use in Server Components / Server Actions.
// Uses the user's session (respects RLS) — never the service role key here.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component with no request context to
            // mutate — safe to ignore if middleware refreshes sessions.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // See note above.
          }
        },
      },
    }
  );
}

// lib/supabase/admin.ts would wrap the service-role key for the narrow set
// of operations that must bypass RLS (e.g. org creation, Stripe webhook
// handlers writing payment status). Never import that client into anything
// that renders user-supplied data back without an explicit authorization
// check first — service role bypasses every policy in 0001_foundation.sql.
