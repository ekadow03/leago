// app/admin/season-builder/[divisionId]/season-builder.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { bulkCreateTeams } from '@/lib/actions/team-import';
import { createTeam } from '@/lib/actions/teams';
import { generateSeasonSchedule } from '@/lib/actions/auto-schedule';

interface Team {
  id: string;
  name: string;
}

interface DaySlot {
  time: string;
  field: string;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTime12h(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

export default function SeasonBuilder({
  organizationId,
  seasonId,
  divisionId,
  divisionName,
  initialTeams,
  existingGameCount,
}: {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  divisionName: string;
  initialTeams: Team[];
  existingGameCount: number;
}) {
  const [teams, setTeams] = useState(initialTeams);

  return (
    <div>
      <TeamImport
        divisionId={divisionId}
        organizationId={organizationId}
        teams={teams}
        setTeams={setTeams}
      />
      <ScheduleGenerator
        organizationId={organizationId}
        seasonId={seasonId}
        divisionId={divisionId}
        divisionName={divisionName}
        teamCount={teams.length}
        existingGameCount={existingGameCount}
      />
    </div>
  );
}

function downloadCsvTemplate() {
  const csv = 'team_name\nRed Sox\nBlue Jays\nYankees\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'team-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function TeamImport({
  divisionId,
  organizationId,
  teams,
  setTeams,
}: {
  divisionId: string;
  organizationId: string;
  teams: Team[];
  setTeams: React.Dispatch<React.SetStateAction<Team[]>>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [addingTeam, setAddingTeam] = useState(false);

  async function handleAddTeam(e: React.FormEvent) {
    e.preventDefault();
    setAddingTeam(true);
    setError(null);
    try {
      const result = await createTeam(organizationId, divisionId, newTeamName);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setTeams((prev) => [...prev, { id: result.id, name: result.name }]);
      setNewTeamName('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingTeam(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const text = await file.text();
      // Simple CSV parse — single column ("team_name"), one name per line.
      // Skips a header row if the first line looks like "team_name".
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const dataLines =
        lines[0]?.toLowerCase().includes('team') ? lines.slice(1) : lines;

      if (dataLines.length === 0) {
        throw new Error('No team names found in that file.');
      }

      const result = await bulkCreateTeams(organizationId, divisionId, dataLines);
      if ('error' in result) {
        throw new Error(result.error);
      }
      // Re-derive the new list is simplest via a light reload of just the
      // names we just sent — real IDs will show correctly after a page
      // refresh, but this keeps the UI responsive immediately.
      setTeams((prev) => [
        ...prev,
        ...dataLines.map((name) => ({ id: `pending-${name}`, name })),
      ]);
      alert(`Imported ${result.count} team(s).`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div className="form-card" style={{ marginBottom: 32 }}>
      <h2>Teams ({teams.length})</h2>

      {teams.length > 0 && (
        <div className="chip-list">
          {teams.map((t) => (
            <span key={t.id} className="chip">{t.name}</span>
          ))}
        </div>
      )}

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}

      <form onSubmit={handleAddTeam} className="add-chip-row">
        <input
          value={newTeamName}
          onChange={(e) => setNewTeamName(e.target.value)}
          className="form-input"
          placeholder="Team name, e.g. Red Sox"
        />
        <button type="submit" disabled={addingTeam || !newTeamName.trim()} className="btn-small">
          {addingTeam ? 'Adding…' : '+ Add team'}
        </button>
      </form>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={downloadCsvTemplate} className="btn-small">
          Download CSV template
        </button>
        <label style={{ cursor: 'pointer' }}>
          <span className="btn-small" style={{ display: 'inline-block' }}>
            {uploading ? 'Importing…' : 'Upload teams CSV'}
          </span>
          <input type="file" accept=".csv" onChange={handleFileChange} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </div>
    </div>
  );
}

function DaySlotEditor({
  day,
  slots,
  fields,
  onAdd,
  onRemove,
}: {
  day: number;
  slots: DaySlot[];
  fields: string[];
  onAdd: (time: string, field: string) => void;
  onRemove: (index: number) => void;
}) {
  const [time, setTime] = useState('17:00');
  const [field, setField] = useState(fields[0] ?? '');

  return (
    <div style={{ background: 'var(--gray-light)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{DAY_LABELS[day]} slots</div>

      {slots.length > 0 && (
        <div className="chip-list">
          {slots.map((s, i) => (
            <span key={`${s.time}-${s.field}`} className="chip">
              {formatTime12h(s.time)} · {s.field}
              <button onClick={() => onRemove(i)}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="add-chip-row">
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="form-input"
          style={{ width: 130 }}
        />
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          className="form-input"
          style={{ width: 170 }}
          disabled={fields.length === 0}
        >
          {fields.length === 0 ? (
            <option value="">Add a field first…</option>
          ) : (
            fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          onClick={() => field && onAdd(time, field)}
          className="btn-small"
          disabled={!field}
        >
          + Add slot
        </button>
      </div>
    </div>
  );
}

function ScheduleGenerator({
  organizationId,
  seasonId,
  divisionId,
  divisionName,
  teamCount,
  existingGameCount,
}: {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  divisionName: string;
  teamCount: number;
  existingGameCount: number;
}) {
  const [fields, setFields] = useState<string[]>([]);
  const [newField, setNewField] = useState('');
  const [activeDays, setActiveDays] = useState<number[]>([]);
  const [daySlots, setDaySlots] = useState<Record<number, DaySlot[]>>({});
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ gamesCreated: number; seasonDatesUsed: number; conflictsAvoided: number } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  function addField() {
    const trimmed = newField.trim();
    if (trimmed && !fields.includes(trimmed)) {
      setFields((prev) => [...prev, trimmed]);
      setNewField('');
    }
  }

  function removeField(field: string) {
    setFields((prev) => prev.filter((f) => f !== field));
    // Slots pointing at a removed field would silently reference a field
    // that no longer exists in the picker — drop them too.
    setDaySlots((prev) => {
      const next: Record<number, DaySlot[]> = {};
      for (const [day, slots] of Object.entries(prev)) {
        next[Number(day)] = slots.filter((s) => s.field !== field);
      }
      return next;
    });
  }

  function toggleDay(day: number) {
    setActiveDays((prev) => {
      if (prev.includes(day)) {
        setDaySlots((s) => {
          const next = { ...s };
          delete next[day];
          return next;
        });
        return prev.filter((d) => d !== day);
      }
      return [...prev, day].sort();
    });
  }

  function addSlot(day: number, time: string, field: string) {
    setDaySlots((prev) => {
      const existing = prev[day] ?? [];
      if (existing.some((s) => s.time === time && s.field === field)) return prev;
      return {
        ...prev,
        [day]: [...existing, { time, field }].sort((a, b) => a.time.localeCompare(b.time)),
      };
    });
  }

  function removeSlot(day: number, index: number) {
    setDaySlots((prev) => ({ ...prev, [day]: (prev[day] ?? []).filter((_, i) => i !== index) }));
  }

  const totalSlots = Object.values(daySlots).reduce((sum, slots) => sum + slots.length, 0);
  const canGenerate = teamCount >= 2 && totalSlots > 0 && !!startDate && !!endDate;

  async function handleGenerate() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const flatSlots = Object.entries(daySlots).flatMap(([day, slots]) =>
        slots.map((s) => ({ dayOfWeek: Number(day), time: s.time, field: s.field }))
      );
      const res = await generateSeasonSchedule({
        organizationId,
        seasonId,
        divisionId,
        daySlots: flatSlots,
        startDate,
        endDate,
      });
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="form-card">
      <h2>Generate season schedule</h2>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginTop: -12, marginBottom: 16 }}>
        Builds a fair round-robin and repeats it across your whole season, so every team plays a roughly equal
        number of games. Each day can have its own times and fields — handy since a field is often shared with
        another division and only free at certain times. Games are created as drafts — review and publish them
        from the <Link href="/admin/schedule" style={{ color: 'var(--green-dark)' }}>Schedule</Link> page when
        ready.
      </p>

      {existingGameCount > 0 && (
        <p style={{ fontSize: 13, color: '#92660B', background: 'rgba(232,185,61,0.15)', padding: '8px 12px', borderRadius: 8, marginBottom: 16 }}>
          This division already has {existingGameCount} game(s) scheduled. Generating again will ADD more games
          alongside them, not replace them.
        </p>
      )}

      <label className="form-label">Fields</label>
      {fields.length > 0 && (
        <div className="chip-list">
          {fields.map((f) => (
            <span key={f} className="chip">
              {f}
              <button onClick={() => removeField(f)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="add-chip-row">
        <input
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addField())}
          className="form-input"
          placeholder="e.g. Field 1"
        />
        <button onClick={addField} className="btn-small">
          + Add field
        </button>
      </div>

      <label className="form-label">Game days &amp; time slots</label>
      <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -8, marginBottom: 12 }}>
        Click a day to configure it, then add each time/field slot it should offer — a weekday might only need
        one slot at 5:00 PM, while Saturday could offer several from 8:00 AM to 9:00 PM across different fields.
      </p>
      <div className="day-grid">
        {DAY_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => toggleDay(i)}
            className={`day-toggle ${activeDays.includes(i) ? 'active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeDays.map((day) => (
        <DaySlotEditor
          key={day}
          day={day}
          slots={daySlots[day] ?? []}
          fields={fields}
          onAdd={(time, field) => addSlot(day, time, field)}
          onRemove={(index) => removeSlot(day, index)}
        />
      ))}

      <label className="form-label">Season start date</label>
      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="form-input" />

      <label className="form-label">Season end date</label>
      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="form-input" />

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}
      {result && (
        <p style={{ color: 'var(--green-dark)', fontSize: 14, fontWeight: 600 }}>
          Created {result.gamesCreated} games across {result.seasonDatesUsed} game dates.
          {result.conflictsAvoided > 0 &&
            ` Skipped ${result.conflictsAvoided} slot(s) already booked by another event.`}
        </p>
      )}

      <button onClick={handleGenerate} disabled={!canGenerate || submitting} className="btn-primary" style={{ width: '100%' }}>
        {submitting ? 'Generating…' : `Generate schedule for ${divisionName}`}
      </button>
      {!canGenerate && (
        <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 8 }}>
          Need at least 2 teams, at least one day with a time/field slot configured, and both dates set.
        </p>
      )}
    </div>
  );
}
