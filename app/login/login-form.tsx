// app/login/login-form.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logIn } from '@/lib/actions/auth';

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await logIn({ email, password });

    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    // next comes from ?next=... on this page's own URL — every gated page
    // in the app redirects here with its own path in that param so login
    // lands you back where you were headed, not always the same place.
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="form-card">
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
        required
      />
      {error && <p style={{ color: '#B23A2E', fontSize: 14, marginBottom: 12 }}>{error}</p>}
      <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
        {submitting ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
