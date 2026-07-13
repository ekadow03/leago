// app/signup/check-email/page.tsx
import Nav from '@/components/nav';

export default function CheckEmailPage() {
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
            <a href="/login" style={{ color: 'var(--green-dark)', fontWeight: 700 }}>
              log in directly
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
