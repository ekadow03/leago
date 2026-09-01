// app/signup/signup-form.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signUp } from '@/lib/actions/auth';

export default function SignUpForm({ next }: { next: string }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signUp({ email, password, firstName, lastName });

    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    // Carry the destination through — the check-email page redirects
    // straight there itself if this Supabase project has email
    // confirmation turned off (signUp() already logged them in), and
    // otherwise keeps it in its own "log in directly" link.
    router.push(`/signup/check-email?next=${encodeURIComponent(next)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="form-card">
      <label className="form-label">First name</label>
      <input
        className="form-input"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        required
      />
      <label className="form-label">Last name</label>
      <input
        className="form-input"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
        required
      />
      <label className="form-label">Email</label>
      <input
        type="email"
        className="form-input"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label className="form-label">Password</label>
      <input
        type="password"
        className="form-input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={6}
        required
      />
      {error && <p style={{ color: '#B23A2E', fontSize: 14, marginBottom: 12 }}>{error}</p>}
      <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
        {submitting ? 'Creating account…' : 'Sign up'}
      </button>
    </form>
  );
}
