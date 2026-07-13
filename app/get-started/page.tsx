// app/get-started/page.tsx
import { createClient } from '@/lib/supabase/server';
import Nav from '@/components/nav';
import CreateLeagueForm from './create-league-form';

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
              <a href="/signup" className="btn-primary" style={{ textDecoration: 'none' }}>
                Sign up
              </a>
              <a href="/login" className="btn-small" style={{ textDecoration: 'none', padding: '14px 20px' }}>
                Log in
              </a>
            </div>
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