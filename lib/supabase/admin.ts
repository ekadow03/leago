// lib/supabase/admin.ts
// Service-role Supabase client. Bypasses RLS entirely — only import this
// into code that:
//   (a) runs strictly server-side (Server Actions, API routes), AND
//   (b) does its own authorization check before touching data, since RLS
//       is no longer doing that job for you.
//
// Primary uses: Stripe webhook handlers (no user session exists at that
// point) and the registration-creation Server Action (needs to write a
// registrations row + a Stripe PaymentIntent as one atomic-ish operation
// before the user necessarily has a confirmed session state).
//
// NEVER import this into a Client Component or anything that could bundle
// it into browser JS — the service role key must never leave the server.

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
