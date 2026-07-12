// app/signup/check-email/page.tsx
export default function CheckEmailPage() {
  return (
    <div style={{ maxWidth: 400, margin: '80px auto', fontFamily: 'system-ui', textAlign: 'center' }}>
      <h1>Check your email</h1>
      <p>
        We sent a confirmation link to your email address. Click it to
        activate your account, then come back and log in.
      </p>
      <p style={{ color: '#666', fontSize: 14, marginTop: 24 }}>
        Note: if your Supabase project has email confirmation disabled (common
        in local dev), you may already be able to{' '}
        <a href="/login">log in directly</a>.
      </p>
    </div>
  );
}
