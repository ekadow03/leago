// app/signup/check-email/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Nav from '@/components/nav';

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If this Supabase project doesn't require email confirmation, signUp()
  // already logged the user in — skip the "check your email" step
  // entirely and continue straight to where they were headed (back to
  // league creation, most of the time) instead of making them read an
  // email that was never sent.
  if (user) {
    redirect(next || '/get-started');
  }

  return (
    <div className="auth-page">
      <Nav />
      <div className="auth-body">
        <div className="form-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
          <h2 style={{ marginTop: 0 }}>Check your email</h2>
          <p style={{ color: 'var(--gray)' }}>
            We sent a confirmation link to your email address. Click it to activate your account, then come back
            and log in.
          </p>
          <p style={{ color: 'var(--gray)', fontSize: 13, marginTop: 20 }}>
            If confirmation is disabled for this project, you may already be able to{' '}
            <a
              href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}
              style={{ color: 'var(--green-dark)', fontWeight: 700 }}
            >
              log in directly
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
