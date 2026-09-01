// components/nav.tsx
//
// Async Server Component — every page that renders <Nav /> is itself a
// Server Component, so this can check auth state directly instead of
// needing a client-side fetch. Shows who's logged in (if anyone) and a
// way to actually log out, which didn't exist anywhere in the app before
// this — with no visible signed-in state and no log out button, it was
// easy to think "Get started free" was skipping the sign up/login gate
// when really the browser already had an active session from earlier.

import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/server';
import { logOut } from '@/lib/actions/auth';

export default async function Nav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <nav className="nav">
      <Link href="/" style={{ display: 'flex', alignItems: 'center' }}>
        <Image src="/leago-logo.png" alt="leago" width={160} height={48} style={{ height: 40, width: 'auto' }} priority />
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {user ? (
          <>
            <Link href="/dashboard" className="btn-small" style={{ textDecoration: 'none' }}>
              Dashboard
            </Link>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{user.email}</span>
            <form action={logOut}>
              <button type="submit" className="btn-small">
                Log out
              </button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login" className="btn-small" style={{ textDecoration: 'none' }}>
              Log in
            </Link>
            <Link href="/signup" className="btn-small" style={{ textDecoration: 'none' }}>
              Sign up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
