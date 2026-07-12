// lib/supabase/client.ts
// Browser-side Supabase client — for Client Components (realtime subscriptions,
// the live draft board, interactive forms before submission).

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
