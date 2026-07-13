// app/admin/tournaments/tournaments-list.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createTournament } from '@/lib/actions/tournaments';

interface Tournament {
  id: string;
  name: string;
  slug: string;
  status: string;
  entry_fee_cents: number;
  start_date: string | null;
}

export default function TournamentsList({
  organizationId,
  organizationName,
  initialTournaments,
}: {
  organizationId: string;
  organizationName: string;
  initialTournaments: Tournament[];
}) {
  const [tournaments, setTournaments] = useState(initialTournaments);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [entryFee, setEntryFee] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const slug = slugify(name);
      const result = await createTournament({
        organizationId,
        name,
        slug,
        entryFeeCents: Math.round(parseFloat(entryFee || '0') * 100),
        startDate: startDate || undefined,
      });
      setTournaments((prev) => [
        {
          id: result.id,
          name,
          slug,
          status: 'draft',
          entry_fee_cents: Math.round(parseFloat(entryFee || '0') * 100),
          start_date: startDate || null,
        },
        ...prev,
      ]);
      setName('');
      setEntryFee('0');
      setStartDate('');
      setShowForm(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>{organizationName} — Tournaments</h1>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <button onClick={() => setShowForm((s) => !s)} style={{ marginBottom: 16 }}>
        {showForm ? 'Cancel' : '+ New tournament'}
      </button>

      {showForm && (
        <form onSubmit={handleCreate} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input placeholder="Tournament name" value={name} onChange={(e) => setName(e.target.value)} required />
            <label>
              Entry fee ($):{' '}
              <input
                type="number"
                min="0"
                step="0.01"
                value={entryFee}
                onChange={(e) => setEntryFee(e.target.value)}
                style={{ width: 80 }}
              />
            </label>
            <label>
              Start date:{' '}
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create tournament'}
            </button>
          </div>
        </form>
      )}

      {tournaments.length === 0 && <p style={{ color: '#666' }}>No tournaments yet.</p>}

      {tournaments.map((t) => (
        <Link
          key={t.id}
          href={`/admin/tournaments/${t.id}`}
          style={{
            display: 'block',
            padding: 12,
            border: '1px solid #ddd',
            borderRadius: 8,
            marginBottom: 8,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <div style={{ fontWeight: 600 }}>{t.name}</div>
          <div style={{ fontSize: 13, color: '#666' }}>
            {t.status} · ${(t.entry_fee_cents / 100).toFixed(2)} entry
            {t.start_date && ` · ${t.start_date}`}
          </div>
        </Link>
      ))}
    </div>
  );
}