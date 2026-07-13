// app/get-started/create-league-form.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createLeagueOrganization } from '@/lib/actions/onboarding';

export default function CreateLeagueForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function slugPreview(text: string): string {
    return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await createLeagueOrganization({ name, slug: name });
      router.push('/admin/league-hub');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-card">
      <label className="form-label">League name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="form-input"
        placeholder="e.g. Riverside Youth Baseball"
        required
      />
      {name && (
        <p style={{ fontSize: 13, color: 'var(--gray)', marginTop: -12, marginBottom: 16 }}>
          Your league page will be at <code>getleago.com/league/{slugPreview(name)}</code>
        </p>
      )}

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}

      <button type="submit" disabled={submitting || !name} className="btn-primary" style={{ width: '100%' }}>
        {submitting ? 'Creating…' : 'Create my league'}
      </button>
    </form>
  );
}