// app/auth/callback/route.ts
import { createClient } from '@/lib/supabase/server';
import { ensurePersonRecord } from '@/lib/people';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { data } = await supabase.auth.exchangeCodeForSession(code);
    // This is the main path for an account that required email
    // confirmation — the first point at which the user is actually
    // authenticated, and so the first safe point to create their
    // people row if sign-up couldn't (see lib/people.ts).
    if (data.user) {
      await ensurePersonRecord(supabase, data.user);
    }
  }

  return NextResponse.redirect(`${origin}/register`);
}
