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
    return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      <button onClick={() => setShowForm((s) => !s)} className="btn-small" style={{ marginBottom: 16 }}>
        {showForm ? 'Cancel' : '+ New tournament'}
      </button>

      {showForm && (
        <form onSubmit={handleCreate} className="form-card" style={{ marginBottom: 24 }}>
          <label className="form-label">Tournament name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="form-input" required />
          <label className="form-label">Entry fee ($)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={entryFee}
            onChange={(e) => setEntryFee(e.target.value)}
            className="form-input"
          />
          <label className="form-label">Start date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="form-input" />
          <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
            {submitting ? 'Creating…' : 'Create tournament'}
          </button>
        </form>
      )}

      {tournaments.length === 0 && <p style={{ color: 'var(--gray)' }}>No tournaments yet.</p>}

      {tournaments.length > 0 && (
        <div className="data-table-card">
          {tournaments.map((t) => (
            <Link key={t.id} href={`/admin/tournaments/${t.id}`} className="data-row" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div>
                <div className="data-row-name">{t.name}</div>
                <div className="data-row-meta">
                  ${(t.entry_fee_cents / 100).toFixed(2)} entry
                  {t.start_date && ` · ${t.start_date}`}
                </div>
              </div>
              <span className={`status-badge ${t.status === 'complete' ? 'confirmed' : 'pending'}`}>{t.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
