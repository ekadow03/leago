// app/admin/season-builder/[divisionId]/season-builder.tsx
'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { generateSeasonSchedule } from '@/lib/actions/auto-schedule';
import { createField } from '@/lib/actions/fields';
import { createBlackout, deleteBlackout } from '@/lib/actions/blackouts';

interface Team {
  id: string;
  name: string;
}

interface OrgField {
  id: string;
  name: string;
}

interface Blackout {
  id: string;
  season_id: string;
  field_name: string | null;
  kind: 'date' | 'weekly' | 'daily';
  blackout_date: string | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  label: string | null;
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
  orgFields,
  initialBlackouts,
}: {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  divisionName: string;
  initialTeams: Team[];
  existingGameCount: number;
  orgFields: OrgField[];
  initialBlackouts: Blackout[];
}) {
  return (
    <div>
      <TeamSummary teams={initialTeams} />
      <ScheduleGenerator
        organizationId={organizationId}
        seasonId={seasonId}
        divisionId={divisionId}
        divisionName={divisionName}
        teamCount={initialTeams.length}
        existingGameCount={existingGameCount}
        orgFields={orgFields}
        initialBlackouts={initialBlackouts}
      />
    </div>
  );
}

// Teams themselves are managed from the org-wide /admin/teams page now
// (manual add there, or a CSV import across every division in a season at
// once) — this is a read-only reminder of who's in the division, with a
// link out to actually change it.
function TeamSummary({ teams }: { teams: Team[] }) {
  return (
    <div className="form-card" style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Teams ({teams.length})</h2>
        <Link href="/admin/teams" className="btn-small">
          Manage teams
        </Link>
      </div>
      {teams.length > 0 ? (
        <div className="chip-list" style={{ marginTop: 12 }}>
          {teams.map((t) => (
            <span key={t.id} className="chip">
              {t.name}
            </span>
          ))}
        </div>
      ) : (
        <p style={{ color: 'var(--gray)', fontSize: 13, marginTop: 12 }}>
          No teams in this division yet — add them from the Teams page before generating a schedule.
        </p>
      )}
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
  orgFields,
  initialBlackouts,
}: {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  divisionName: string;
  teamCount: number;
  existingGameCount: number;
  orgFields: OrgField[];
  initialBlackouts: Blackout[];
}) {
  const [blackouts, setBlackouts] = useState(initialBlackouts);

  // Fields selected for THIS division's schedule — a subset of the
  // organization's shared field registry (migration 0016). Picking from
  // that shared list, rather than free-typing a name per division, is
  // what keeps generateSeasonSchedule()'s cross-division conflict check
  // reliable: it matches on the literal location string, so "Field 1"
  // typed twice with different casing would otherwise silently defeat it.
  const [availableOrgFields, setAvailableOrgFields] = useState<OrgField[]>(orgFields);
  const [fields, setFields] = useState<string[]>([]);
  const [fieldToAdd, setFieldToAdd] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [addingField, setAddingField] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
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
    blackoutsSkipped: number;
    targetReached: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Adds an already-registered org field to THIS division's active list
  // — no server call needed, it's already in the shared registry.
  function addExistingField() {
    if (fieldToAdd && !fields.includes(fieldToAdd)) {
      setFields((prev) => [...prev, fieldToAdd]);
    }
    setFieldToAdd('');
  }

  // Registers a brand-new field name with the organization (so every
  // other division can pick it from the dropdown too, instead of
  // retyping it) and activates it for this division's schedule.
  async function addNewField() {
    const trimmed = newFieldName.trim();
    if (!trimmed) return;
    setAddingField(true);
    setFieldError(null);
    try {
      const result = await createField(organizationId, trimmed);
      if ('error' in result) {
        setFieldError(result.error);
        return;
      }
      setAvailableOrgFields((prev) =>
        prev.some((f) => f.id === result.id)
          ? prev
          : [...prev, { id: result.id, name: result.name }].sort((a, b) => a.name.localeCompare(b.name))
      );
      setFields((prev) => (prev.includes(result.name) ? prev : [...prev, result.name]));
      setNewFieldName('');
    } catch (err: any) {
      setFieldError(err.message);
    } finally {
      setAddingField(false);
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

      <BlackoutPanel
        organizationId={organizationId}
        seasonId={seasonId}
        fields={availableOrgFields}
        blackouts={blackouts}
        onAdded={(b) => setBlackouts((prev) => [...prev, b])}
        onRemoved={(id) => setBlackouts((prev) => prev.filter((b) => b.id !== id))}
      />

      <label className="form-label">Fields</label>
      <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -8, marginBottom: 12 }}>
        Fields come from your organization&apos;s shared field list (manage the full list from the admin Dashboard)
        so that a game booked here is recognized as a conflict by every other division&apos;s schedule too.
      </p>
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

      {fieldError && <p style={{ color: '#B23A2E', fontSize: 13 }}>{fieldError}</p>}

      {availableOrgFields.filter((f) => !fields.includes(f.name)).length > 0 && (
        <div className="add-chip-row">
          <select value={fieldToAdd} onChange={(e) => setFieldToAdd(e.target.value)} className="form-input">
            <option value="">Choose a field…</option>
            {availableOrgFields
              .filter((f) => !fields.includes(f.name))
              .map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}
                </option>
              ))}
          </select>
          <button onClick={addExistingField} disabled={!fieldToAdd} className="btn-small">
            + Add field
          </button>
        </div>
      )}

      <div className="add-chip-row">
        <input
          value={newFieldName}
          onChange={(e) => setNewFieldName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addNewField())}
          className="form-input"
          placeholder="Not listed? Add a new field, e.g. Field 3"
        />
        <button onClick={addNewField} disabled={addingField || !newFieldName.trim()} className="btn-small">
          {addingField ? 'Adding…' : '+ New field'}
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
            Created {result.gamesCreated} games across {result.weeksScheduled} round(s).
            {result.conflictsAvoided > 0 &&
              ` Skipped ${result.conflictsAvoided} slot(s) already booked by another event.`}
            {result.blackoutsSkipped > 0 &&
              ` Skipped ${result.blackoutsSkipped} slot(s) blocked by a blackout.`}
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

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describeBlackout(b: Blackout): string {
  const timeRange = b.start_time && b.end_time ? `${formatTime12h(b.start_time)}–${formatTime12h(b.end_time)}` : 'All day';
  const field = b.field_name ? b.field_name : 'All fields';
  let when: string;
  if (b.kind === 'date' && b.blackout_date) {
    when = new Date(`${b.blackout_date}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } else if (b.kind === 'weekly' && b.day_of_week !== null) {
    when = `Every ${DAY_NAMES[b.day_of_week]}`;
  } else {
    when = 'Every day';
  }
  return `${when} · ${timeRange} · ${field}${b.label ? ` — ${b.label}` : ''}`;
}

// Blackouts are season-scoped (migration 0017) — set here, right next to
// the slots/dates they constrain, but they apply to every division that
// shares this season, not just the one whose Schedule screen this is.
function BlackoutPanel({
  organizationId,
  seasonId,
  fields,
  blackouts,
  onAdded,
  onRemoved,
}: {
  organizationId: string;
  seasonId: string;
  fields: OrgField[];
  blackouts: Blackout[];
  onAdded: (b: Blackout) => void;
  onRemoved: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<'date' | 'weekly' | 'daily'>('date');
  const [blackoutDate, setBlackoutDate] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('0');
  const [fullDay, setFullDay] = useState(true);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [fieldName, setFieldName] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await createBlackout({
        organizationId,
        seasonId,
        kind,
        fieldName: fieldName || undefined,
        blackoutDate: kind === 'date' ? blackoutDate : undefined,
        dayOfWeek: kind === 'weekly' ? Number(dayOfWeek) : undefined,
        startTime: fullDay ? undefined : startTime || undefined,
        endTime: fullDay ? undefined : endTime || undefined,
        label: label || undefined,
      });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onAdded({
        id: result.id,
        season_id: seasonId,
        field_name: fieldName || null,
        kind,
        blackout_date: kind === 'date' ? blackoutDate : null,
        day_of_week: kind === 'weekly' ? Number(dayOfWeek) : null,
        start_time: fullDay ? null : startTime || null,
        end_time: fullDay ? null : endTime || null,
        label: label.trim() || null,
      });
      setBlackoutDate('');
      setStartTime('');
      setEndTime('');
      setFieldName('');
      setLabel('');
      setFullDay(true);
      setShowForm(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(blackoutId: string) {
    if (!confirm('Remove this blackout? Future schedule generation will be able to use that time again.')) return;
    setError(null);
    try {
      const result = await deleteBlackout(organizationId, blackoutId);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onRemoved(blackoutId);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="form-card" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Blackout dates &amp; times</h2>
          <p style={{ fontSize: 12, color: 'var(--gray)', margin: '4px 0 0' }}>
            Dates/times schedule generation will skip over — a holiday, field maintenance, a standing conflict.
            Applies to every division sharing this season, not just this one.
          </p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-small">
          {showForm ? 'Cancel' : '+ Add blackout'}
        </button>
      </div>

      {error && <p style={{ color: '#B23A2E', fontSize: 13, marginTop: 8 }}>{error}</p>}

      {showForm && (
        <form onSubmit={handleAdd} style={{ marginTop: 12 }}>
          <label className="form-label">Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="form-input">
            <option value="date">Specific date (e.g. a holiday)</option>
            <option value="weekly">Same day every week this season</option>
            <option value="daily">Every day this season</option>
          </select>

          {kind === 'date' && (
            <>
              <label className="form-label">Date</label>
              <input
                type="date"
                value={blackoutDate}
                onChange={(e) => setBlackoutDate(e.target.value)}
                className="form-input"
                required
              />
            </>
          )}

          {kind === 'weekly' && (
            <>
              <label className="form-label">Day of week</label>
              <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className="form-input">
                {DAY_NAMES.map((name, i) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, margin: '12px 0' }}>
            <input type="checkbox" checked={fullDay} onChange={(e) => setFullDay(e.target.checked)} />
            {kind === 'date' ? 'Block the entire day' : 'Block the entire day, every time this occurs'}
          </label>

          {!fullDay && (
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Start time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="form-input"
                  style={{ width: 160 }}
                  required
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">End time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="form-input"
                  style={{ width: 160 }}
                  required
                />
              </div>
            </div>
          )}

          <label className="form-label">Field</label>
          <select value={fieldName} onChange={(e) => setFieldName(e.target.value)} className="form-input">
            <option value="">All fields</option>
            {fields.map((f) => (
              <option key={f.id} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>

          <label className="form-label">Label (optional)</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="form-input"
            placeholder="e.g. Thanksgiving, Field 2 resurfacing"
          />

          <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
            {submitting ? 'Adding…' : 'Add blackout'}
          </button>
        </form>
      )}

      {blackouts.length > 0 ? (
        <div className="data-table-card" style={{ marginTop: 16 }}>
          {blackouts.map((b) => (
            <div key={b.id} className="data-row">
              <div className="data-row-name">{describeBlackout(b)}</div>
              <button onClick={() => handleRemove(b.id)} className="btn-small">
                Delete
              </button>
            </div>
          ))}
        </div>
      ) : (
        !showForm && <p style={{ color: 'var(--gray)', fontSize: 13, marginTop: 12 }}>No blackouts set for this season.</p>
      )}
    </div>
  );
}
