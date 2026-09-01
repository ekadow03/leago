// app/admin/season-builder/[divisionId]/season-builder.tsx
'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { bulkCreateTeams } from '@/lib/actions/team-import';
import { createTeam } from '@/lib/actions/teams';
import { generateSeasonSchedule } from '@/lib/actions/auto-schedule';

interface Team {
  id: string;
  name: string;
}

interface TimeGroup {
  time: string;
  fields: string[];
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

function TimeGroupRow({
  time,
  fields,
  allFields,
  onAddField,
  onRemoveField,
  onRemoveTime,
}: {
  time: string;
  fields: string[];
  allFields: string[];
  onAddField: (field: string) => void;
  onRemoveField: (field: string) => void;
  onRemoveTime: () => void;
}) {
  const availableToAdd = allFields.filter((f) => !fields.includes(f));
  const selectRef = useRef<HTMLSelectElement>(null);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
      <span style={{ fontWeight: 700, fontSize: 13, minWidth: 90 }}>{formatTime12h(time)}</span>

      {fields.map((f) => (
        <span key={f} className="chip">
          {f}
          <button onClick={() => onRemoveField(f)}>×</button>
        </span>
      ))}

      {availableToAdd.length > 0 ? (
        <>
          <select ref={selectRef} className="form-input" style={{ width: 150, marginBottom: 0 }} key={availableToAdd.join(',')}>
            {availableToAdd.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-small"
            onClick={() => {
              if (selectRef.current?.value) onAddField(selectRef.current.value);
            }}
          >
            + Add field
          </button>
        </>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--gray)' }}>All fields added</span>
      )}

      <button type="button" onClick={onRemoveTime} className="btn-small" style={{ marginLeft: 'auto' }}>
        Remove time
      </button>
    </div>
  );
}

function DaySlotEditor({
  day,
  timeGroups,
  fields,
  onAddTime,
  onRemoveTime,
  onAddField,
  onRemoveField,
}: {
  day: number;
  timeGroups: TimeGroup[];
  fields: string[];
  onAddTime: (time: string) => void;
  onRemoveTime: (time: string) => void;
  onAddField: (time: string, field: string) => void;
  onRemoveField: (time: string, field: string) => void;
}) {
  const [newTime, setNewTime] = useState('17:00');

  return (
    <div style={{ background: 'var(--gray-light)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{DAY_LABELS[day]} slots</div>

      {timeGroups.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 10 }}>No times yet — add one below.</p>
      )}

      {timeGroups.map((g) => (
        <TimeGroupRow
          key={g.time}
          time={g.time}
          fields={g.fields}
          allFields={fields}
          onAddField={(field) => onAddField(g.time, field)}
          onRemoveField={(field) => onRemoveField(g.time, field)}
          onRemoveTime={() => onRemoveTime(g.time)}
        />
      ))}

      <div className="add-chip-row" style={{ marginTop: timeGroups.length > 0 ? 4 : 0 }}>
        <input
          type="time"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          className="form-input"
          style={{ width: 160 }}
        />
        <button type="button" onClick={() => onAddTime(newTime)} className="btn-small">
          + Add time
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
  const [daySlots, setDaySlots] = useState<Record<number, TimeGroup[]>>({});
  const [gamesPerTeam, setGamesPerTeam] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    gamesCreated: number;
    weeksScheduled: number;
    conflictsAvoided: number;
    targetReached: boolean;
  } | null>(null);
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
    // A time group pointing at a removed field would silently reference a
    // field that no longer exists in the picker — drop it from every
    // group across every day too.
    setDaySlots((prev) => {
      const next: Record<number, TimeGroup[]> = {};
      for (const [day, groups] of Object.entries(prev)) {
        next[Number(day)] = groups.map((g) => ({ ...g, fields: g.fields.filter((f) => f !== field) }));
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

  function addTimeToDay(day: number, time: string) {
    setDaySlots((prev) => {
      const existing = prev[day] ?? [];
      if (existing.some((g) => g.time === time)) return prev;
      return {
        ...prev,
        [day]: [...existing, { time, fields: [] }].sort((a, b) => a.time.localeCompare(b.time)),
      };
    });
  }

  function removeTimeFromDay(day: number, time: string) {
    setDaySlots((prev) => ({ ...prev, [day]: (prev[day] ?? []).filter((g) => g.time !== time) }));
  }

  function addFieldToTime(day: number, time: string, field: string) {
    setDaySlots((prev) => ({
      ...prev,
      [day]: (prev[day] ?? []).map((g) =>
        g.time === time && !g.fields.includes(field) ? { ...g, fields: [...g.fields, field] } : g
      ),
    }));
  }

  function removeFieldFromTime(day: number, time: string, field: string) {
    setDaySlots((prev) => ({
      ...prev,
      [day]: (prev[day] ?? []).map((g) => (g.time === time ? { ...g, fields: g.fields.filter((f) => f !== field) } : g)),
    }));
  }

  const totalSlots = Object.values(daySlots).reduce(
    (sum, groups) => sum + groups.reduce((s, g) => s + g.fields.length, 0),
    0
  );
  const gamesPerTeamNum = Number(gamesPerTeam);
  const canGenerate =
    teamCount >= 2 &&
    totalSlots > 0 &&
    !!startDate &&
    !!endDate &&
    Number.isFinite(gamesPerTeamNum) &&
    gamesPerTeamNum >= 1;

  async function handleGenerate() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const flatSlots = Object.entries(daySlots).flatMap(([day, groups]) =>
        groups.flatMap((g) => g.fields.map((field) => ({ dayOfWeek: Number(day), time: g.time, field })))
      );
      const res = await generateSeasonSchedule({
        organizationId,
        seasonId,
        divisionId,
        daySlots: flatSlots,
        gamesPerTeam: gamesPerTeamNum,
        startDate,
        endDate,
        // Read here (in the browser) rather than on the server, since the
        // server action runs on Vercel in UTC and has no idea what "5pm"
        // is supposed to mean for this league.
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
        number of games. Each day can have its own times, and each time can offer more than one field for
        simultaneous games — handy since a field is often shared with another division and only free at certain
        times. Games are created as drafts — review and publish them from the{' '}
        <Link href="/admin/schedule" style={{ color: 'var(--green-dark)' }}>
          Schedule
        </Link>{' '}
        page when ready.
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
        Click a day to configure it. Add a time, then add every field that has a game at that time — a weekday
        might only need 5:00 PM on one field, while Saturday could have 8:00 AM across two fields, 10:00 AM
        across two more, and so on.
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
          timeGroups={daySlots[day] ?? []}
          fields={fields}
          onAddTime={(time) => addTimeToDay(day, time)}
          onRemoveTime={(time) => removeTimeFromDay(day, time)}
          onAddField={(time, field) => addFieldToTime(day, time, field)}
          onRemoveField={(time, field) => removeFieldFromTime(day, time, field)}
        />
      ))}

      <label className="form-label">Regular season games per team</label>
      <input
        type="number"
        min={1}
        value={gamesPerTeam}
        onChange={(e) => setGamesPerTeam(e.target.value)}
        className="form-input"
        placeholder="e.g. 12"
        style={{ maxWidth: 120 }}
      />
      <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -4, marginBottom: 12 }}>
        Schedule generation stops once every team has reached this many games, even if the end date hasn&apos;t
        been reached yet. If the date range and slots run out first, some teams may fall short — you&apos;ll see a
        warning below when that happens.
      </p>

      <label className="form-label">Season start date</label>
      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="form-input" />

      <label className="form-label">Season end date (last possible day)</label>
      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="form-input" />

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}
      {result && (
        <>
          <p style={{ color: 'var(--green-dark)', fontSize: 14, fontWeight: 600 }}>
            Created {result.gamesCreated} games across {result.weeksScheduled} week(s).
            {result.conflictsAvoided > 0 &&
              ` Skipped ${result.conflictsAvoided} slot(s) already booked by another event.`}
          </p>
          {!result.targetReached && (
            <p style={{ color: '#B23A2E', fontSize: 13, marginTop: -4 }}>
              Heads up: not every team reached {gamesPerTeamNum} games before the end date. Add more times/fields,
              extend the end date, or lower the games-per-team target and regenerate.
            </p>
          )}
        </>
      )}

      <button onClick={handleGenerate} disabled={!canGenerate || submitting} className="btn-primary" style={{ width: '100%' }}>
        {submitting ? 'Generating…' : `Generate schedule for ${divisionName}`}
      </button>
      {!canGenerate && (
        <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 8 }}>
          Need at least 2 teams, at least one time with a field added, a games-per-team target of 1 or more, and
          both dates set.
        </p>
      )}
    </div>
  );
}
