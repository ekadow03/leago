// app/admin/season-manager.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createSeason } from '@/lib/actions/seasons';
import { createDivision } from '@/lib/actions/divisions';

interface Season {
  id: string;
  name: string;
  status: string;
  registration_open_at: string | null;
  registration_close_at: string | null;
}

interface Division {
  id: string;
  season_id: string;
  name: string;
  age_min: number | null;
  age_max: number | null;
  price_cents: number;
}

export default function SeasonManager({
  organizationId,
  initialSeasons,
  initialDivisions,
  teamCounts,
}: {
  organizationId: string;
  initialSeasons: Season[];
  initialDivisions: Division[];
  teamCounts: Record<string, number>;
}) {
  const [seasons, setSeasons] = useState(initialSeasons);
  const [divisions, setDivisions] = useState(initialDivisions);
  const [showSeasonForm, setShowSeasonForm] = useState(initialSeasons.length === 0);
  const [seasonName, setSeasonName] = useState('');
  const [regOpen, setRegOpen] = useState('');
  const [regClose, setRegClose] = useState('');
  const [creatingSeason, setCreatingSeason] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateSeason(e: React.FormEvent) {
    e.preventDefault();
    setCreatingSeason(true);
    setError(null);
    try {
      const result = await createSeason({
        organizationId,
        name: seasonName,
        registrationOpenAt: regOpen ? new Date(regOpen).toISOString() : undefined,
        registrationCloseAt: regClose ? new Date(regClose).toISOString() : undefined,
      });
      setSeasons((prev) => [
        {
          id: result.id,
          name: seasonName,
          status: 'draft',
          registration_open_at: regOpen ? new Date(regOpen).toISOString() : null,
          registration_close_at: regClose ? new Date(regClose).toISOString() : null,
        },
        ...prev,
      ]);
      setSeasonName('');
      setRegOpen('');
      setRegClose('');
      setShowSeasonForm(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreatingSeason(false);
    }
  }

  function handleDivisionCreated(division: Division) {
    setDivisions((prev) => [...prev, division]);
  }

  return (
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      <div className="form-card" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Seasons</h2>
          <button onClick={() => setShowSeasonForm((s) => !s)} className="btn-small">
            {showSeasonForm ? 'Cancel' : '+ New season'}
          </button>
        </div>

        {showSeasonForm && (
          <form onSubmit={handleCreateSeason} style={{ marginTop: 16 }}>
            <label className="form-label">Season name</label>
            <input
              value={seasonName}
              onChange={(e) => setSeasonName(e.target.value)}
              className="form-input"
              placeholder="e.g. Fall 2026 Season"
              required
            />
            <label className="form-label">Registration opens (optional)</label>
            <input type="date" value={regOpen} onChange={(e) => setRegOpen(e.target.value)} className="form-input" />
            <label className="form-label">Registration closes (optional)</label>
            <input type="date" value={regClose} onChange={(e) => setRegClose(e.target.value)} className="form-input" />
            <button type="submit" disabled={creatingSeason || !seasonName} className="btn-primary" style={{ width: '100%' }}>
              {creatingSeason ? 'Creating…' : 'Create season'}
            </button>
          </form>
        )}
      </div>

      {seasons.length === 0 && !showSeasonForm && (
        <p style={{ color: 'var(--gray)' }}>No seasons yet — create one above to start scheduling.</p>
      )}

      {seasons.map((season) => (
        <SeasonCard
          key={season.id}
          organizationId={organizationId}
          season={season}
          divisions={divisions.filter((d) => d.season_id === season.id)}
          teamCounts={teamCounts}
          onDivisionCreated={handleDivisionCreated}
        />
      ))}
    </div>
  );
}

function SeasonCard({
  organizationId,
  season,
  divisions,
  teamCounts,
  onDivisionCreated,
}: {
  organizationId: string;
  season: Season;
  divisions: Division[];
  teamCounts: Record<string, number>;
  onDivisionCreated: (d: Division) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const priceCents = price ? Math.round(parseFloat(price) * 100) : 0;
      const result = await createDivision({
        organizationId,
        seasonId: season.id,
        name,
        ageMin: ageMin ? Number(ageMin) : undefined,
        ageMax: ageMax ? Number(ageMax) : undefined,
        priceCents,
      });
      onDivisionCreated({
        id: result.id,
        season_id: season.id,
        name,
        age_min: ageMin ? Number(ageMin) : null,
        age_max: ageMax ? Number(ageMax) : null,
        price_cents: priceCents,
      });
      setName('');
      setAgeMin('');
      setAgeMax('');
      setPrice('');
      setShowForm(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="form-card" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>{season.name}</h2>
          <p style={{ fontSize: 13, color: 'var(--gray)', margin: '4px 0 0' }}>
            {season.status}
            {season.registration_open_at &&
              ` · registration opens ${new Date(season.registration_open_at).toLocaleDateString()}`}
          </p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-small">
          {showForm ? 'Cancel' : '+ Add division'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ marginTop: 16 }}>
          <input
            placeholder="Division name, e.g. 10U"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="form-input"
            required
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <input placeholder="Min age" type="number" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} className="form-input" />
            <input placeholder="Max age" type="number" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} className="form-input" />
          </div>
          <input
            placeholder="Registration price, e.g. 120.00 (leave blank for free)"
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="form-input"
          />
          {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}
          <button type="submit" disabled={submitting || !name} className="btn-primary" style={{ width: '100%' }}>
            {submitting ? 'Adding…' : 'Add division'}
          </button>
        </form>
      )}

      {divisions.length === 0 && !showForm && (
        <p style={{ color: 'var(--gray)', marginTop: 16 }}>No divisions yet.</p>
      )}

      {divisions.length > 0 && (
        <div className="data-table-card" style={{ marginTop: 16 }}>
          {divisions.map((d) => {
            const count = teamCounts[d.id] ?? 0;
            return (
              <div key={d.id} className="data-row">
                <div>
                  <div className="data-row-name">{d.name}</div>
                  <div className="data-row-meta">
                    {d.age_min && d.age_max ? `Ages ${d.age_min}–${d.age_max} · ` : ''}
                    {d.price_cents > 0 ? `$${(d.price_cents / 100).toFixed(2)}` : 'Free'} · {count} team{count === 1 ? '' : 's'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Link href={`/admin/season-builder/${d.id}`} className="btn-small">
                    Teams &amp; schedule
                  </Link>
                  <Link href={`/admin/draft/${d.id}`} className="btn-small">
                    Draft
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
