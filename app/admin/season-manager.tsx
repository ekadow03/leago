// app/admin/season-manager.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createSeason, setSeasonArchived, deleteSeason, updateSeasonAgeCutoff } from '@/lib/actions/seasons';
import { createDivision, updateDivisionPriority } from '@/lib/actions/divisions';
import { createField, deleteField } from '@/lib/actions/fields';
import { setFieldPriority, removeFieldPriority } from '@/lib/actions/field-priorities';
import { upsertRegistrationSettings } from '@/lib/actions/registration-settings';

interface Season {
  id: string;
  name: string;
  status: string;
  registration_open_at: string | null;
  registration_close_at: string | null;
  age_cutoff_date: string | null;
}

// One row per season (0020_registration_and_household.sql) — the fixed set
// of optional fields the front-end registration form shows/requires.
interface RegistrationSettings {
  season_id: string;
  require_waiver: boolean;
  waiver_text: string | null;
  require_birth_certificate: boolean;
  offer_jersey_size: boolean;
  jersey_sizes: string[];
  offer_hat_size: boolean;
  hat_sizes: string[];
  offer_jersey_number: boolean;
  offer_years_experience: boolean;
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

// One division's rank (1 = highest) among the divisions competing for a
// field — see migration 0018. Editable from either the Fields panel
// (pick a field, manage its division ranking) or a division row (pick
// fields for that division) — same rows either way.
interface FieldPriority {
  id: string;
  field_id: string;
  division_id: string;
  priority: number;
}

export default function SeasonManager({
  organizationId,
  initialSeasons,
  initialDivisions,
  teamCounts,
  initialFields,
  initialFieldPriorities,
  initialRegistrationSettings,
}: {
  organizationId: string;
  initialSeasons: Season[];
  initialDivisions: Division[];
  teamCounts: Record<string, number>;
  initialFields: Field[];
  initialFieldPriorities: FieldPriority[];
  initialRegistrationSettings: RegistrationSettings[];
}) {
  const [seasons, setSeasons] = useState(initialSeasons);
  const [divisions, setDivisions] = useState(initialDivisions);
  const [fields, setFields] = useState(initialFields);
  const [fieldPriorities, setFieldPriorities] = useState(initialFieldPriorities);
  const [registrationSettings, setRegistrationSettings] = useState(initialRegistrationSettings);

  function handleRegistrationSettingsChanged(settings: RegistrationSettings) {
    setRegistrationSettings((prev) => {
      const withoutThisSeason = prev.filter((s) => s.season_id !== settings.season_id);
      return [...withoutThisSeason, settings];
    });
  }

  // Shared by both editing surfaces (the Fields panel and each division
  // row) — upserts one (field, division) rank in local state to match
  // what setFieldPriority() just wrote server-side.
  function applyFieldPriority(fieldId: string, divisionId: string, priority: number) {
    setFieldPriorities((prev) => {
      const existing = prev.find((p) => p.field_id === fieldId && p.division_id === divisionId);
      if (existing) {
        return prev.map((p) => (p === existing ? { ...p, priority } : p));
      }
      return [...prev, { id: `${fieldId}:${divisionId}`, field_id: fieldId, division_id: divisionId, priority }];
    });
  }

  function removeFieldPriorityLocal(fieldId: string, divisionId: string) {
    setFieldPriorities((prev) => prev.filter((p) => !(p.field_id === fieldId && p.division_id === divisionId)));
  }
  const [showSeasonForm, setShowSeasonForm] = useState(initialSeasons.length === 0);
  const [showArchived, setShowArchived] = useState(false);
  const [seasonName, setSeasonName] = useState('');
  const [regOpen, setRegOpen] = useState('');
  const [regClose, setRegClose] = useState('');
  const [ageCutoff, setAgeCutoff] = useState('');
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
        ageCutoffDate: ageCutoff || undefined,
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
          age_cutoff_date: ageCutoff || null,
        },
        ...prev,
      ]);
      setSeasonName('');
      setRegOpen('');
      setRegClose('');
      setAgeCutoff('');
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

  function handleSeasonArchiveChanged(seasonId: string, archived: boolean) {
    setSeasons((prev) =>
      prev.map((s) => (s.id === seasonId ? { ...s, status: archived ? 'archived' : 'draft' } : s))
    );
  }

  function handleAgeCutoffChanged(seasonId: string, ageCutoffDate: string | null) {
    setSeasons((prev) => prev.map((s) => (s.id === seasonId ? { ...s, age_cutoff_date: ageCutoffDate } : s)));
  }

  function handleSeasonDeleted(seasonId: string) {
    setSeasons((prev) => prev.filter((s) => s.id !== seasonId));
    setDivisions((prev) => prev.filter((d) => d.season_id !== seasonId));
  }

  const activeSeasons = seasons.filter((s) => s.status !== 'archived');
  const archivedSeasons = seasons.filter((s) => s.status === 'archived');

  return (
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      <FieldsPanel organizationId={organizationId} fields={fields} onFieldsChange={setFields} />

      <FieldPriorityPanel
        organizationId={organizationId}
        fields={fields}
        divisions={divisions}
        seasons={seasons}
        fieldPriorities={fieldPriorities}
        onChanged={applyFieldPriority}
        onRemoved={removeFieldPriorityLocal}
      />

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
            <label className="form-label">Age cutoff date (optional)</label>
            <input type="date" value={ageCutoff} onChange={(e) => setAgeCutoff(e.target.value)} className="form-input" />
            <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -12, marginBottom: 16 }}>
              Player age for division eligibility is computed as of this date (e.g. many leagues use 8/1 or 1/1).
              Leave blank if your divisions aren&apos;t age-restricted.
            </p>
            <button type="submit" disabled={creatingSeason || !seasonName} className="btn-primary" style={{ width: '100%' }}>
              {creatingSeason ? 'Creating…' : 'Create season'}
            </button>
          </form>
        )}
      </div>

      {seasons.length === 0 && !showSeasonForm && (
        <p style={{ color: 'var(--gray)' }}>No seasons yet — create one above to start scheduling.</p>
      )}

      {activeSeasons.map((season) => (
        <SeasonCard
          key={season.id}
          organizationId={organizationId}
          season={season}
          divisions={divisions.filter((d) => d.season_id === season.id)}
          teamCounts={teamCounts}
          fields={fields}
          fieldPriorities={fieldPriorities}
          registrationSettings={registrationSettings.find((s) => s.season_id === season.id) ?? null}
          onDivisionCreated={handleDivisionCreated}
          onPriorityChanged={handlePriorityChanged}
          onFieldPriorityChanged={applyFieldPriority}
          onFieldPriorityRemoved={removeFieldPriorityLocal}
          onArchiveChanged={handleSeasonArchiveChanged}
          onDeleted={handleSeasonDeleted}
          onRegistrationSettingsChanged={handleRegistrationSettingsChanged}
          onAgeCutoffChanged={handleAgeCutoffChanged}
        />
      ))}

      {archivedSeasons.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={() => setShowArchived((s) => !s)} className="btn-small">
            {showArchived ? 'Hide' : 'Show'} archived seasons ({archivedSeasons.length})
          </button>
          {showArchived &&
            archivedSeasons.map((season) => (
              <SeasonCard
                key={season.id}
                organizationId={organizationId}
                season={season}
                divisions={divisions.filter((d) => d.season_id === season.id)}
                teamCounts={teamCounts}
                fields={fields}
                fieldPriorities={fieldPriorities}
                registrationSettings={registrationSettings.find((s) => s.season_id === season.id) ?? null}
                onDivisionCreated={handleDivisionCreated}
                onPriorityChanged={handlePriorityChanged}
                onFieldPriorityChanged={applyFieldPriority}
                onFieldPriorityRemoved={removeFieldPriorityLocal}
                onArchiveChanged={handleSeasonArchiveChanged}
                onDeleted={handleSeasonDeleted}
                onRegistrationSettingsChanged={handleRegistrationSettingsChanged}
                onAgeCutoffChanged={handleAgeCutoffChanged}
              />
            ))}
        </div>
      )}
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

// Field-centric priority editing: pick a field, see the divisions
// competing for it ranked 1 (highest) upward, reorder by typing a new
// number, add another division (appended after whoever's already there),
// or remove one. Same field_priorities rows a division row edits too —
// see migration 0018.
function FieldPriorityPanel({
  organizationId,
  fields,
  divisions,
  seasons,
  fieldPriorities,
  onChanged,
  onRemoved,
}: {
  organizationId: string;
  fields: Field[];
  divisions: Division[];
  seasons: Season[];
  fieldPriorities: FieldPriority[];
  onChanged: (fieldId: string, divisionId: string, priority: number) => void;
  onRemoved: (fieldId: string, divisionId: string) => void;
}) {
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [addDivisionId, setAddDivisionId] = useState('');
  const [error, setError] = useState<string | null>(null);

  function divisionLabel(divisionId: string): string {
    const d = divisions.find((x) => x.id === divisionId);
    if (!d) return 'Unknown division';
    const season = seasons.find((s) => s.id === d.season_id);
    return season ? `${d.name} (${season.name})` : d.name;
  }

  if (fields.length === 0) return null;

  const rowsForField = fieldPriorities
    .filter((p) => p.field_id === selectedFieldId)
    .sort((a, b) => a.priority - b.priority);
  const availableDivisions = divisions.filter((d) => !rowsForField.some((r) => r.division_id === d.id));

  async function handleAddDivision() {
    if (!selectedFieldId || !addDivisionId) return;
    setError(null);
    const nextPriority = rowsForField.length > 0 ? Math.max(...rowsForField.map((r) => r.priority)) + 1 : 1;
    const result = await setFieldPriority(organizationId, selectedFieldId, addDivisionId, nextPriority);
    if (result && 'error' in result) {
      setError(result.error);
      return;
    }
    onChanged(selectedFieldId, addDivisionId, nextPriority);
    setAddDivisionId('');
  }

  async function handlePriorityChange(divisionId: string, value: number) {
    if (!selectedFieldId || !Number.isFinite(value) || value < 1) return;
    setError(null);
    const result = await setFieldPriority(organizationId, selectedFieldId, divisionId, value);
    if (result && 'error' in result) {
      setError(result.error);
      return;
    }
    onChanged(selectedFieldId, divisionId, value);
  }

  async function handleRemove(divisionId: string) {
    if (!selectedFieldId) return;
    setError(null);
    const result = await removeFieldPriority(organizationId, selectedFieldId, divisionId);
    if (result && 'error' in result) {
      setError(result.error);
      return;
    }
    onRemoved(selectedFieldId, divisionId);
  }

  return (
    <div className="form-card" style={{ marginBottom: 32 }}>
      <h2 style={{ margin: 0 }}>Field priority</h2>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginTop: 4 }}>
        Pick a field to rank which division has first claim on it. When a lower-ranked division generates its
        schedule, any field where a higher-ranked division hasn&apos;t been scheduled yet is reserved and skipped
        for it automatically — set this up for any field two or more divisions share.
      </p>

      <label className="form-label">Field</label>
      <select
        value={selectedFieldId}
        onChange={(e) => setSelectedFieldId(e.target.value)}
        className="form-input"
        style={{ maxWidth: 260 }}
      >
        <option value="">Select a field…</option>
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}

      {selectedFieldId && (
        <>
          {rowsForField.length === 0 && (
            <p style={{ color: 'var(--gray)', fontSize: 13, marginTop: 12 }}>
              No divisions ranked on this field yet — every division can use it on a first-generated basis.
            </p>
          )}
          {rowsForField.length > 0 && (
            <div className="data-table-card" style={{ marginTop: 12 }}>
              {rowsForField.map((row) => (
                <div key={row.division_id} className="data-row">
                  <div className="data-row-name">{divisionLabel(row.division_id)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--gray)' }}>
                      Priority
                      <input
                        type="number"
                        min={1}
                        defaultValue={row.priority}
                        onBlur={(e) => {
                          const value = Number(e.target.value);
                          if (value !== row.priority) handlePriorityChange(row.division_id, value);
                        }}
                        className="form-input"
                        style={{ width: 56, marginBottom: 0, padding: '4px 6px' }}
                      />
                    </label>
                    <button type="button" onClick={() => handleRemove(row.division_id)} className="btn-small">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {availableDivisions.length > 0 && (
            <div className="add-chip-row" style={{ marginTop: 12 }}>
              <select value={addDivisionId} onChange={(e) => setAddDivisionId(e.target.value)} className="form-input">
                <option value="">Add a division…</option>
                {availableDivisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {divisionLabel(d.id)}
                  </option>
                ))}
              </select>
              <button type="button" onClick={handleAddDivision} disabled={!addDivisionId} className="btn-small">
                + Add
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SeasonCard({
  organizationId,
  season,
  divisions,
  teamCounts,
  fields,
  fieldPriorities,
  registrationSettings,
  onDivisionCreated,
  onPriorityChanged,
  onFieldPriorityChanged,
  onFieldPriorityRemoved,
  onArchiveChanged,
  onDeleted,
  onRegistrationSettingsChanged,
  onAgeCutoffChanged,
}: {
  organizationId: string;
  season: Season;
  divisions: Division[];
  teamCounts: Record<string, number>;
  fields: Field[];
  fieldPriorities: FieldPriority[];
  registrationSettings: RegistrationSettings | null;
  onDivisionCreated: (d: Division) => void;
  onPriorityChanged: (divisionId: string, priority: number) => void;
  onFieldPriorityChanged: (fieldId: string, divisionId: string, priority: number) => void;
  onFieldPriorityRemoved: (fieldId: string, divisionId: string) => void;
  onArchiveChanged: (seasonId: string, archived: boolean) => void;
  onDeleted: (seasonId: string) => void;
  onRegistrationSettingsChanged: (settings: RegistrationSettings) => void;
  onAgeCutoffChanged: (seasonId: string, ageCutoffDate: string | null) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [showRegSettings, setShowRegSettings] = useState(false);
  const [ageCutoffSaving, setAgeCutoffSaving] = useState(false);
  const [name, setName] = useState('');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isArchived = season.status === 'archived';

  async function handleToggleArchive() {
    setArchiving(true);
    setError(null);
    try {
      const result = await setSeasonArchived(organizationId, season.id, !isArchived);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onArchiveChanged(season.id, !isArchived);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setArchiving(false);
    }
  }

  async function handleDelete() {
    if (
      !confirm(
        `Delete ${season.name}? This can't be undone. It only works if the season has no registrations, teams, or scheduled events — archive it instead if you want to keep that history.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteSeason(organizationId, season.id);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onDeleted(season.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

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
  const [expandedFieldsFor, setExpandedFieldsFor] = useState<Set<string>>(new Set());

  function toggleFieldsExpanded(divisionId: string) {
    setExpandedFieldsFor((prev) => {
      const next = new Set(prev);
      if (next.has(divisionId)) next.delete(divisionId);
      else next.add(divisionId);
      return next;
    });
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>
            Age cutoff date
            <input
              type="date"
              defaultValue={season.age_cutoff_date ?? ''}
              disabled={ageCutoffSaving}
              onBlur={async (e) => {
                const value = e.target.value || null;
                if (value === season.age_cutoff_date) return;
                setAgeCutoffSaving(true);
                const result = await updateSeasonAgeCutoff(organizationId, season.id, value);
                setAgeCutoffSaving(false);
                if (result && 'error' in result) {
                  setError(result.error);
                  return;
                }
                onAgeCutoffChanged(season.id, value);
              }}
              className="form-input"
              style={{ width: 150, marginBottom: 0, padding: '4px 6px' }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isArchived && (
            <button onClick={() => setShowForm((s) => !s)} className="btn-small">
              {showForm ? 'Cancel' : '+ Add division'}
            </button>
          )}
          <button onClick={() => setShowRegSettings((s) => !s)} className="btn-small">
            {showRegSettings ? 'Hide registration settings' : 'Registration settings'}
          </button>
          <button onClick={handleToggleArchive} disabled={archiving} className="btn-small">
            {archiving ? '…' : isArchived ? 'Unarchive' : 'Archive'}
          </button>
          <button onClick={handleDelete} disabled={deleting} className="btn-small">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {error && <p style={{ color: '#B23A2E', fontSize: 14, marginTop: 8 }}>{error}</p>}

      {showRegSettings && (
        <RegistrationSettingsPanel
          organizationId={organizationId}
          seasonId={season.id}
          settings={registrationSettings}
          onChanged={onRegistrationSettingsChanged}
        />
      )}

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
            const expanded = expandedFieldsFor.has(d.id);
            return (
              <div key={d.id}>
                <div className="data-row">
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
                    <button type="button" onClick={() => toggleFieldsExpanded(d.id)} className="btn-small">
                      {expanded ? 'Hide fields' : 'Fields'}
                    </button>
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
                {expanded && (
                  <DivisionFieldPriorityEditor
                    organizationId={organizationId}
                    divisionId={d.id}
                    fields={fields}
                    fieldPriorities={fieldPriorities}
                    onChanged={onFieldPriorityChanged}
                    onRemoved={onFieldPriorityRemoved}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Division-centric priority editing: pick fields for one division, in the
// order you want them prioritized. The first field picked becomes this
// division's rank 1 there if no one else has claimed it yet; if the
// field's already got other divisions ranked on it, this one is appended
// after them (edit the number directly, here or on the Fields panel
// above, to override). Same field_priorities rows either editor writes.
function DivisionFieldPriorityEditor({
  organizationId,
  divisionId,
  fields,
  fieldPriorities,
  onChanged,
  onRemoved,
}: {
  organizationId: string;
  divisionId: string;
  fields: Field[];
  fieldPriorities: FieldPriority[];
  onChanged: (fieldId: string, divisionId: string, priority: number) => void;
  onRemoved: (fieldId: string, divisionId: string) => void;
}) {
  const [addFieldId, setAddFieldId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rowsForDivision = fieldPriorities
    .filter((p) => p.division_id === divisionId)
    .sort((a, b) => a.priority - b.priority);
  const availableFields = fields.filter((f) => !rowsForDivision.some((r) => r.field_id === f.id));

  function fieldName(fieldId: string): string {
    return fields.find((f) => f.id === fieldId)?.name ?? 'Unknown field';
  }

  async function handleAddField() {
    if (!addFieldId) return;
    setError(null);
    // Appended after whichever divisions already rank on this field —
    // if none do yet, this becomes priority 1 (top) automatically.
    const rowsForThisField = fieldPriorities.filter((p) => p.field_id === addFieldId);
    const nextPriority = rowsForThisField.length > 0 ? Math.max(...rowsForThisField.map((r) => r.priority)) + 1 : 1;
    const result = await setFieldPriority(organizationId, addFieldId, divisionId, nextPriority);
    if (result && 'error' in result) {
      setError(result.error);
      return;
    }
    onChanged(addFieldId, divisionId, nextPriority);
    setAddFieldId('');
  }

  async function handlePriorityChange(fieldId: string, value: number) {
    if (!Number.isFinite(value) || value < 1) return;
    setError(null);
    const result = await setFieldPriority(organizationId, fieldId, divisionId, value);
    if (result && 'error' in result) {
      setError(result.error);
      return;
    }
    onChanged(fieldId, divisionId, value);
  }

  async function handleRemove(fieldId: string) {
    setError(null);
    const result = await removeFieldPriority(organizationId, fieldId, divisionId);
    if (result && 'error' in result) {
      setError(result.error);
      return;
    }
    onRemoved(fieldId, divisionId);
  }

  return (
    <div style={{ padding: '12px 16px', background: 'var(--cream)', borderRadius: 8, margin: '4px 0 12px' }}>
      <p style={{ fontSize: 12, color: 'var(--gray)', margin: '0 0 8px' }}>
        Fields this division has priority on, highest first. Used to pre-fill the schedule generator and to reserve
        a field against lower-priority divisions until this one has been scheduled there.
      </p>

      {error && <p style={{ color: '#B23A2E', fontSize: 13 }}>{error}</p>}

      {rowsForDivision.length === 0 && (
        <p style={{ color: 'var(--gray)', fontSize: 13, margin: 0 }}>No fields prioritized yet.</p>
      )}

      {rowsForDivision.length > 0 && (
        <div className="chip-list" style={{ marginBottom: 8 }}>
          {rowsForDivision.map((row) => (
            <span key={row.field_id} className="chip">
              {fieldName(row.field_id)}
              <input
                type="number"
                min={1}
                defaultValue={row.priority}
                onBlur={(e) => {
                  const value = Number(e.target.value);
                  if (value !== row.priority) handlePriorityChange(row.field_id, value);
                }}
                style={{ width: 40, marginLeft: 6, padding: '2px 4px', fontSize: 12 }}
              />
              <button type="button" onClick={() => handleRemove(row.field_id)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {availableFields.length > 0 && (
        <div className="add-chip-row">
          <select value={addFieldId} onChange={(e) => setAddFieldId(e.target.value)} className="form-input">
            <option value="">Add a field…</option>
            {availableFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleAddField} disabled={!addFieldId} className="btn-small">
            + Add
          </button>
        </div>
      )}
    </div>
  );
}

// Admin-configurable set of optional registration fields for one season —
// see 0020_registration_and_household.sql. Fixed field set (not a form
// builder): waiver, birth certificate, jersey/hat size, jersey number,
// years experience, each toggleable on/off, matching how Evan described
// SportsConnect/SportsEngine-style registration configuration.
function RegistrationSettingsPanel({
  organizationId,
  seasonId,
  settings,
  onChanged,
}: {
  organizationId: string;
  seasonId: string;
  settings: RegistrationSettings | null;
  onChanged: (settings: RegistrationSettings) => void;
}) {
  const [requireWaiver, setRequireWaiver] = useState(settings?.require_waiver ?? false);
  const [waiverText, setWaiverText] = useState(settings?.waiver_text ?? '');
  const [requireBirthCertificate, setRequireBirthCertificate] = useState(
    settings?.require_birth_certificate ?? false
  );
  const [offerJerseySize, setOfferJerseySize] = useState(settings?.offer_jersey_size ?? false);
  const [jerseySizesText, setJerseySizesText] = useState((settings?.jersey_sizes ?? []).join(', '));
  const [offerHatSize, setOfferHatSize] = useState(settings?.offer_hat_size ?? false);
  const [hatSizesText, setHatSizesText] = useState((settings?.hat_sizes ?? []).join(', '));
  const [offerJerseyNumber, setOfferJerseyNumber] = useState(settings?.offer_jersey_number ?? false);
  const [offerYearsExperience, setOfferYearsExperience] = useState(settings?.offer_years_experience ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function parseSizes(text: string): string[] {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const jerseySizes = parseSizes(jerseySizesText);
    const hatSizes = parseSizes(hatSizesText);

    const result = await upsertRegistrationSettings({
      organizationId,
      seasonId,
      requireWaiver,
      waiverText,
      requireBirthCertificate,
      offerJerseySize,
      jerseySizes,
      offerHatSize,
      hatSizes,
      offerJerseyNumber,
      offerYearsExperience,
    });

    setSaving(false);

    if (result && 'error' in result) {
      setError(result.error);
      return;
    }

    onChanged({
      season_id: seasonId,
      require_waiver: requireWaiver,
      waiver_text: waiverText.trim() || null,
      require_birth_certificate: requireBirthCertificate,
      offer_jersey_size: offerJerseySize,
      jersey_sizes: jerseySizes,
      offer_hat_size: offerHatSize,
      hat_sizes: hatSizes,
      offer_jersey_number: offerJerseyNumber,
      offer_years_experience: offerYearsExperience,
    });
    setSaved(true);
  }

  return (
    <div style={{ padding: '14px 16px', background: 'var(--cream)', borderRadius: 8, margin: '4px 0 16px' }}>
      <p style={{ fontSize: 12, color: 'var(--gray)', margin: '0 0 12px' }}>
        Choose which fields families see on the registration form for this season. Waiver and birth certificate can
        be required; the rest are optional collection fields.
      </p>

      {error && <p style={{ color: '#B23A2E', fontSize: 13 }}>{error}</p>}

      <label className="radio-option" style={{ marginBottom: 4 }}>
        <input type="checkbox" checked={requireWaiver} onChange={(e) => setRequireWaiver(e.target.checked)} />
        <span className="radio-option-label">Require a signed waiver</span>
      </label>
      {requireWaiver && (
        <textarea
          value={waiverText}
          onChange={(e) => setWaiverText(e.target.value)}
          placeholder="Waiver text shown to the registrant before they sign…"
          className="form-input"
          rows={3}
          style={{ marginBottom: 12 }}
        />
      )}

      <label className="radio-option" style={{ marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={requireBirthCertificate}
          onChange={(e) => setRequireBirthCertificate(e.target.checked)}
        />
        <span className="radio-option-label">Require a birth certificate upload</span>
      </label>

      <label className="radio-option" style={{ marginBottom: 4 }}>
        <input type="checkbox" checked={offerJerseySize} onChange={(e) => setOfferJerseySize(e.target.checked)} />
        <span className="radio-option-label">Collect jersey size</span>
      </label>
      {offerJerseySize && (
        <input
          value={jerseySizesText}
          onChange={(e) => setJerseySizesText(e.target.value)}
          placeholder="Comma-separated sizes, e.g. YS, YM, YL, AS, AM, AL"
          className="form-input"
          style={{ marginBottom: 12 }}
        />
      )}

      <label className="radio-option" style={{ marginBottom: 4 }}>
        <input type="checkbox" checked={offerHatSize} onChange={(e) => setOfferHatSize(e.target.checked)} />
        <span className="radio-option-label">Collect hat size</span>
      </label>
      {offerHatSize && (
        <input
          value={hatSizesText}
          onChange={(e) => setHatSizesText(e.target.value)}
          placeholder="Comma-separated sizes, e.g. S/M, L/XL"
          className="form-input"
          style={{ marginBottom: 12 }}
        />
      )}

      <label className="radio-option" style={{ marginBottom: 4 }}>
        <input
          type="checkbox"
          checked={offerJerseyNumber}
          onChange={(e) => setOfferJerseyNumber(e.target.checked)}
        />
        <span className="radio-option-label">Collect requested jersey number</span>
      </label>

      <label className="radio-option" style={{ marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={offerYearsExperience}
          onChange={(e) => setOfferYearsExperience(e.target.checked)}
        />
        <span className="radio-option-label">Collect years of experience</span>
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : 'Save registration settings'}
        </button>
        {saved && <span style={{ fontSize: 12, color: 'var(--green-dark)' }}>Saved</span>}
      </div>
    </div>
  );
}
