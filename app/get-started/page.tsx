// app/get-started/page.tsx
import { createClient } from '@/lib/supabase/server';
import Nav from '@/components/nav';
import CreateLeagueForm from './create-league-form';
import { getCurrentUserMemberships } from '@/lib/org-context';
import Link from 'next/link';

export default async function GetStartedPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="auth-page">
        <Nav />
        <div className="auth-body">
          <div className="form-card" style={{ textAlign: 'center' }}>
            <h2 style={{ marginTop: 0 }}>Let's create your account first</h2>
            <p style={{ color: 'var(--gray)' }}>
              You'll need an account before setting up your league. Come back to this page afterward and we'll walk
              you through creating your league.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20 }}>
              <a href="/signup?next=/get-started" className="btn-primary" style={{ textDecoration: 'none' }}>
                Sign up
              </a>
              <a href="/login?next=/get-started" className="btn-small" style={{ textDecoration: 'none', padding: '14px 20px' }}>
                Log in
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // A signed-in user who already runs a league should land back on it,
  // not be asked to create a new one every time — "Get started free" is
  // also the link used from the homepage nav, which doesn't know whether
  // the visitor is brand new or a returning admin.
  const memberships = await getCurrentUserMemberships();
  const adminOrgs = memberships.filter((m) => m.roles.includes('admin'));

  if (adminOrgs.length > 0) {
    return (
      <div className="auth-page">
        <Nav />
        <div className="auth-body">
          <div className="form-card" style={{ textAlign: 'center' }}>
            <h2 style={{ marginTop: 0 }}>Welcome back</h2>
            <p style={{ color: 'var(--gray)' }}>
              You already run {adminOrgs.length === 1 ? adminOrgs[0].organizationName : `${adminOrgs.length} leagues`}{' '}
              on leago.
            </p>
            {adminOrgs.length > 1 && (
              <ul style={{ textAlign: 'left', margin: '0 0 16px' }}>
                {adminOrgs.map((org) => (
                  <li key={org.organizationId} style={{ marginBottom: 4 }}>
                    {org.organizationName}
                  </li>
                ))}
              </ul>
            )}
            <Link href="/admin" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Go to your admin dashboard
            </Link>
            <details style={{ marginTop: 24, textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--gray)', fontSize: 14 }}>
                Start a different league instead
              </summary>
              <div style={{ marginTop: 16 }}>
                <CreateLeagueForm />
              </div>
            </details>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <Nav />
      <div className="auth-body">
        <h1>Create your league</h1>
        <CreateLeagueForm />
      </div>
    </div>
  );
}
