// proxy.ts (place at project ROOT, not inside app/)
//
// Two jobs: (1) refresh the Supabase auth session on every request, and
// (2) detect a white-label tournament subdomain (e.g. acmetourneys.leago.com)
// and rewrite the root path to that org's tournament listing page.
//
// The subdomain piece is NOT testable on localhost — there's no
// subdomain to detect when running on localhost:3000. It'll start
// working automatically once this app is deployed to a real domain with
// wildcard DNS configured in Vercel (Settings → Domains → add *.yourdomain.com)
// and NEXT_PUBLIC_ROOT_DOMAIN is set to that real domain in production env vars.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'leago.com';

export async function proxy(request: NextRequest) {
  const hostname = request.headers.get('host')?.split(':')[0] ?? '';
  const pathname = request.nextUrl.pathname;

  // Subdomain detection: only rewrite the root path of an actual
  // subdomain of ROOT_DOMAIN, excluding www and the bare root domain
  // itself. Everything else (deep links like /tournaments/some-slug)
  // passes through unchanged and works the same regardless of host.
  if (
    pathname === '/' &&
    hostname.endsWith(`.${ROOT_DOMAIN}`) &&
    hostname !== ROOT_DOMAIN &&
    hostname !== `www.${ROOT_DOMAIN}`
  ) {
    const subdomain = hostname.slice(0, -(ROOT_DOMAIN.length + 1));
    const url = request.nextUrl.clone();
    url.pathname = `/org-tournaments/${subdomain}`;
    return NextResponse.rewrite(url);
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};