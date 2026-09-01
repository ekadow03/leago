// app/admin/season-manager.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createSeason } from '@/lib/actions/seasons';
import { createDivision, updateDivisionPriority } from '@/lib/actions/divisions';
import { createField, deleteField } from '@/lib/actions/fields';

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
  schedule_priority: number;
}

interface Field {
  id: string;
  name: string;
}

export default function SeasonManager({
  organizationId,
  initialSeasons,
  initialDivisions,
  teamCounts,
  initialFields,
}: {
  organizationId: string;
  initialSeasons: Season[];
  initialDivisions: Division[];
  teamCounts: Record<string, number>;
  initialFields: Field[];
}) {
  const [seasons, setSeasons] = useState(initialSeasons);
  const [divisions, setDivisions] = useState(initialDivisions);
  const [fields, setFields] = useState(initialFields);
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
      if ('error' in result) {
        setError(result.error);
        return;
      }
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

  function handlePriorityChanged(divisionId: string, priority: number) {
    setDivisions((prev) => prev.map((d) => (d.id === divisionId ? { ...d, schedule_priority: priority } : d)));
  }

  return (
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      <FieldsPanel organizationId={organizationId} fields={fields} onFieldsChange={setFields} />

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
          onPriorityChanged={handlePriorityChanged}
        />
      ))}
    </div>
  );
}

function FieldsPanel({
  organizationId,
  fields,
  onFieldsChange,
}: {
  organizationId: string;
  fields: Field[];
  onFieldsChange: (fields: Field[]) => void;
}) {
  const [newFieldName, setNewFieldName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const trimmed = newFieldName.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createField(organizationId, trimmed);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      if (!fields.some((f) => f.id === result.id)) {
        onFieldsChange([...fields, { id: result.id, name: result.name }].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setNewFieldName('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(fieldId: string) {
    if (!confirm('Remove this field? Divisions that already reference it in a generated schedule are unaffected.')) return;
    setError(null);
    try {
      const result = await deleteField(organizationId, fieldId);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onFieldsChange(fields.filter((f) => f.id !== fieldId));
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="form-card" style={{ marginBottom: 32 }}>
      <h2 style={{ margin: 0 }}>Fields</h2>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginTop: 4 }}>
        One shared list of physical fields/courts for this organization, used when building any division&apos;s
        schedule. Keeping field names here (instead of retyping them per division) is what lets the schedule
        generator reliably catch two divisions being booked onto the same field at the same time.
      </p>

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}

      {fields.length > 0 && (
        <div className="chip-list" style={{ marginTop: 12 }}>
          {fields.map((f) => (
            <span key={f.id} className="chip">
              {f.name}
              <button type="button" onClick={() => handleRemove(f.id)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {fields.length === 0 && (
        <p style={{ color: 'var(--gray)', fontSize: 13, marginTop: 12 }}>No fields added yet.</p>
      )}

      <div className="add-chip-row" style={{ marginTop: 12 }}>
        <input
          value={newFieldName}
          onChange={(e) => setNewFieldName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
          className="form-input"
          placeholder="e.g. Field 1"
        />
        <button type="button" onClick={handleAdd} disabled={submitting || !newFieldName.trim()} className="btn-small">
          {submitting ? 'Adding…' : '+ Add field'}
        </button>
      </div>
    </div>
  );
}

function SeasonCard({
  organizationId,
  season,
  divisions,
  teamCounts,
  onDivisionCreated,
  onPriorityChanged,
}: {
  organizationId: string;
  season: Season;
  divisions: Division[];
  teamCounts: Record<string, number>;
  onDivisionCreated: (d: Division) => void;
  onPriorityChanged: (divisionId: string, priority: number) => void;
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
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onDivisionCreated({
        id: result.id,
        season_id: season.id,
        name,
        age_min: ageMin ? Number(ageMin) : null,
        age_max: ageMax ? Number(ageMax) : null,
        price_cents: priceCents,
        schedule_priority: 0,
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

  const sortedDivisions = [...divisions].sort(
    (a, b) => a.schedule_priority - b.schedule_priority || a.name.localeCompare(b.name)
  );

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

      {divisions.length > 1 && (
        <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 16, marginBottom: 0 }}>
          Sharing fields between these divisions? Set a priority below (lower number = generate its schedule
          first) so you know which order to click &quot;Generate schedule&quot; in — whichever division generates
          first claims a shared field/time slot.
        </p>
      )}

      {divisions.length > 0 && (
        <div className="data-table-card" style={{ marginTop: 16 }}>
          {sortedDivisions.map((d) => {
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {divisions.length > 1 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--gray)' }}>
                      Priority
                      <input
                        type="number"
                        defaultValue={d.schedule_priority}
                        onBlur={(e) => {
                          const value = Number(e.target.value);
                          if (Number.isFinite(value) && value !== d.schedule_priority) {
                            updateDivisionPriority(organizationId, d.id, value);
                            onPriorityChanged(d.id, value);
                          }
                        }}
                        className="form-input"
                        style={{ width: 56, marginBottom: 0, padding: '4px 6px' }}
                      />
                    </label>
                  )}
                  <Link href="/admin/teams" className="btn-small">
                    Manage teams
                  </Link>
                  <Link href={`/admin/season-builder/${d.id}`} className="btn-small">
                    Schedule
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
