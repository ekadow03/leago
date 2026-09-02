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

// Matches auto-schedule.ts's DaySlotInput shape exactly — this is the
// flat list stored verbatim in schedule_generation_settings.day_slots
// (migration 0019) and handed straight to generateSeasonSchedule().
interface SavedDaySlot {
  dayOfWeek: number;
  time: string;
  field: string;
  // Which independent round-robin track this day's games belong to (see
  // DaySlotInput in auto-schedule.ts). Optional so settings saved before
  // this feature still restore fine — every slot for a day carries the
  // same value, since the picker assigns a group per day, not per slot.
  roundGroup?: string;
}

interface SavedSettings {
  day_slots: SavedDaySlot[];
  games_per_team: number;
  game_duration_minutes: number;
  start_date: string;
  end_date: string;
  max_games_per_week: number | null;
  week_start_day: number;
}

// Regroups a flat saved slot list back into the picker's per-day,
// per-time state shape — the inverse of the flattening handleGenerate()
// does before calling generateSeasonSchedule().
function slotsToPickerState(slots: SavedDaySlot[]): {
  activeDays: number[];
  daySlots: Record<number, TimeGroup[]>;
  dayRoundGroup: Record<number, string>;
} {
  const activeDays = Array.from(new Set(slots.map((s) => s.dayOfWeek))).sort((a, b) => a - b);
  const daySlots: Record<number, TimeGroup[]> = {};
  const dayRoundGroup: Record<number, string> = {};
  for (const slot of slots) {
    const groups = daySlots[slot.dayOfWeek] ?? (daySlots[slot.dayOfWeek] = []);
    let group = groups.find((g) => g.time === slot.time);
    if (!group) {
      group = { time: slot.time, fields: [] };
      groups.push(group);
    }
    if (!group.fields.includes(slot.field)) group.fields.push(slot.field);
    if (!dayRoundGroup[slot.dayOfWeek]) dayRoundGroup[slot.dayOfWeek] = slot.roundGroup || 'A';
  }
  for (const day of Object.keys(daySlots)) {
    daySlots[Number(day)].sort((a, b) => a.time.localeCompare(b.time));
  }
  return { activeDays, daySlots, dayRoundGroup };
}

// A fixed, small set of round-robin track labels an admin can assign a
// day to — plenty for the realistic cases (a weeknight track and a
// Saturday track being the most common) without an open-ended "add a
// group" control to manage.
const ROUND_GROUP_OPTIONS = ['A', 'B', 'C', 'D'];

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
  draftGameCount,
  publishedGameCount,
  orgFields,
  initialBlackouts,
  initialFieldNames,
  initialSettings,
}: {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  divisionName: string;
  initialTeams: Team[];
  draftGameCount: number;
  publishedGameCount: number;
  orgFields: OrgField[];
  initialBlackouts: Blackout[];
  initialFieldNames: string[];
  initialSettings: SavedSettings | null;
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
        draftGameCount={draftGameCount}
        publishedGameCount={publishedGameCount}
        orgFields={orgFields}
        initialBlackouts={initialBlackouts}
        initialFieldNames={initialFieldNames}
        initialSettings={initialSettings}
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
  roundGroup,
  onChangeRoundGroup,
  onAddTime,
  onRemoveTime,
  onAddField,
  onRemoveField,
}: {
  day: number;
  timeGroups: TimeGroup[];
  fields: string[];
  roundGroup: string;
  onChangeRoundGroup: (group: string) => void;
  onAddTime: (time: string) => void;
  onRemoveTime: (time: string) => void;
  onAddField: (time: string, field: string) => void;
  onRemoveField: (time: string, field: string) => void;
}) {
  const [newTime, setNewTime] = useState('17:00');

  return (
    <div style={{ background: 'var(--gray-light)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{DAY_LABELS[day]} slots</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gray)' }}>
          Round group
          <select
            value={roundGroup}
            onChange={(e) => onChangeRoundGroup(e.target.value)}
            className="form-input"
            style={{ width: 64, marginBottom: 0, padding: '4px 6px' }}
          >
            {ROUND_GROUP_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
      </div>

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
  draftGameCount,
  publishedGameCount,
  orgFields,
  initialBlackouts,
  initialFieldNames,
  initialSettings,
}: {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  divisionName: string;
  teamCount: number;
  draftGameCount: number;
  publishedGameCount: number;
  orgFields: OrgField[];
  initialBlackouts: Blackout[];
  initialFieldNames: string[];
  initialSettings: SavedSettings | null;
}) {
  const [blackouts, setBlackouts] = useState(initialBlackouts);

  // Restore the last-used generation inputs (migration 0019) when this
  // division has been generated before, so regenerating with updated
  // teams/blackouts/priorities is a single click instead of re-entering
  // every day/time/field/date. Falls back to the field-priority prefill
  // (migration 0018) and otherwise-blank picker state for a division
  // that's never been generated yet.
  const restored = initialSettings ? slotsToPickerState(initialSettings.day_slots) : null;
  const restoredFieldNames = initialSettings
    ? Array.from(new Set(initialSettings.day_slots.map((s) => s.field)))
    : initialFieldNames;

  // Fields selected for THIS division's schedule — a subset of the
  // organization's shared field registry (migration 0016). Picking from
  // that shared list, rather than free-typing a name per division, is
  // what keeps generateSeasonSchedule()'s cross-division conflict check
  // reliable: it matches on the literal location string, so "Field 1"
  // typed twice with different casing would otherwise silently defeat it.
  const [availableOrgFields, setAvailableOrgFields] = useState<OrgField[]>(orgFields);
  const [fields, setFields] = useState<string[]>(restoredFieldNames);
  const [fieldToAdd, setFieldToAdd] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [addingField, setAddingField] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [activeDays, setActiveDays] = useState<number[]>(restored?.activeDays ?? []);
  const [daySlots, setDaySlots] = useState<Record<number, TimeGroup[]>>(restored?.daySlots ?? {});
  // Which round-robin track (see ROUND_GROUP_OPTIONS) each active day
  // feeds into. A day not present here defaults to 'A' — the single
  // shared track every day starts in, so ignoring this control entirely
  // reproduces the old one-continuous-round-robin behavior.
  const [dayRoundGroup, setDayRoundGroup] = useState<Record<number, string>>(restored?.dayRoundGroup ?? {});
  const [gamesPerTeam, setGamesPerTeam] = useState(initialSettings ? String(initialSettings.games_per_team) : '');
  const [gameDuration, setGameDuration] = useState(
    initialSettings ? String(initialSettings.game_duration_minutes) : '60'
  );
  const [startDate, setStartDate] = useState(initialSettings?.start_date ?? '');
  const [endDate, setEndDate] = useState(initialSettings?.end_date ?? '');
  const [maxGamesPerWeek, setMaxGamesPerWeek] = useState(
    initialSettings?.max_games_per_week ? String(initialSettings.max_games_per_week) : ''
  );
  const [weekStartDay, setWeekStartDay] = useState(String(initialSettings?.week_start_day ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    gamesCreated: number;
    replacedCount: number;
    weeksScheduled: number;
    conflictsAvoided: number;
    blackoutsSkipped: number;
    fieldsReserved: number;
    coachConflictsAvoided: number;
    weeklyCapDeferred: number;
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
        setDayRoundGroup((g) => {
          const next = { ...g };
          delete next[day];
          return next;
        });
        return prev.filter((d) => d !== day);
      }
      setDayRoundGroup((g) => (g[day] ? g : { ...g, [day]: 'A' }));
      return [...prev, day].sort();
    });
  }

  function setRoundGroupForDay(day: number, group: string) {
    setDayRoundGroup((prev) => ({ ...prev, [day]: group }));
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
  const gameDurationNum = Number(gameDuration);
  const maxGamesPerWeekNum = maxGamesPerWeek.trim() === '' ? null : Number(maxGamesPerWeek);
  const maxGamesPerWeekValid =
    maxGamesPerWeekNum === null || (Number.isFinite(maxGamesPerWeekNum) && maxGamesPerWeekNum >= 1);
  const canGenerate =
    teamCount >= 2 &&
    totalSlots > 0 &&
    !!startDate &&
    !!endDate &&
    Number.isFinite(gamesPerTeamNum) &&
    gamesPerTeamNum >= 1 &&
    Number.isFinite(gameDurationNum) &&
    gameDurationNum >= 1 &&
    maxGamesPerWeekValid;

  async function handleGenerate() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const flatSlots = Object.entries(daySlots).flatMap(([day, groups]) =>
        groups.flatMap((g) =>
          g.fields.map((field) => ({
            dayOfWeek: Number(day),
            time: g.time,
            field,
            roundGroup: dayRoundGroup[Number(day)] ?? 'A',
          }))
        )
      );
      const res = await generateSeasonSchedule({
        organizationId,
        seasonId,
        divisionId,
        daySlots: flatSlots,
        gamesPerTeam: gamesPerTeamNum,
        gameDurationMinutes: gameDurationNum,
        startDate,
        endDate,
        maxGamesPerWeek: maxGamesPerWeekNum ?? undefined,
        weekStartDay: Number(weekStartDay),
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

      {(draftGameCount > 0 || publishedGameCount > 0) && (
        <p style={{ fontSize: 13, color: '#92660B', background: 'rgba(232,185,61,0.15)', padding: '8px 12px', borderRadius: 8, marginBottom: 16 }}>
          {draftGameCount > 0 && publishedGameCount > 0 && (
            <>
              This division has {publishedGameCount} published game(s) and {draftGameCount} draft game(s).
              Generating will replace the {draftGameCount} draft game(s) with a fresh schedule — published games
              are left alone.
            </>
          )}
          {draftGameCount > 0 && publishedGameCount === 0 && (
            <>
              This division has {draftGameCount} draft game(s) from a previous generation. Generating again
              replaces them with a fresh schedule reflecting current teams, blackouts, and field priorities.
            </>
          )}
          {draftGameCount === 0 && publishedGameCount > 0 && (
            <>
              This division has {publishedGameCount} published game(s). Generating will add a new draft schedule
              alongside them — published games are never changed or removed by generating.
            </>
          )}
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

      {activeDays.length > 1 && (
        <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -4, marginBottom: 12 }}>
          Days in the same round group share one continuous round-robin schedule. Give a day its own group
          (e.g. Saturday as group B while weeknights stay group A) so its games form separate, complete rounds
          instead of a weeknight round quietly spilling into the weekend.
        </p>
      )}

      {activeDays.map((day) => (
        <DaySlotEditor
          key={day}
          day={day}
          timeGroups={daySlots[day] ?? []}
          fields={fields}
          roundGroup={dayRoundGroup[day] ?? 'A'}
          onChangeRoundGroup={(group) => setRoundGroupForDay(day, group)}
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

      <label className="form-label">Game duration (minutes)</label>
      <input
        type="number"
        min={1}
        value={gameDuration}
        onChange={(e) => setGameDuration(e.target.value)}
        className="form-input"
        placeholder="e.g. 60"
        style={{ maxWidth: 120 }}
      />
      <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -4, marginBottom: 12 }}>
        Used to set each game&apos;s end time — this also drives the duration column when you export the
        schedule for GameChanger.
      </p>

      <label className="form-label">Season start date</label>
      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="form-input" />

      <label className="form-label">Season end date (last possible day)</label>
      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="form-input" />

      <label className="form-label">Max games per week (optional)</label>
      <input
        type="number"
        min={1}
        value={maxGamesPerWeek}
        onChange={(e) => setMaxGamesPerWeek(e.target.value)}
        className="form-input"
        placeholder="No limit"
        style={{ maxWidth: 120 }}
      />
      <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -4, marginBottom: 12 }}>
        Caps how many games any one team plays within a single week. If a team would otherwise be scheduled
        for more, the extra game is pushed to a later week instead — leave blank for no limit.
      </p>

      <label className="form-label">Week starts on</label>
      <select value={weekStartDay} onChange={(e) => setWeekStartDay(e.target.value)} className="form-input" style={{ maxWidth: 200 }}>
        {DAY_NAMES.map((name, i) => (
          <option key={i} value={i}>
            {name}
          </option>
        ))}
      </select>
      <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -4, marginBottom: 12 }}>
        Which day begins a &ldquo;week&rdquo; for the max-games-per-week limit above — e.g. Sunday for a Sun–Sat
        week, or Monday for a Mon–Sun week. Only matters if you set a limit.
      </p>

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}
      {result && (
        <>
          <p style={{ color: 'var(--green-dark)', fontSize: 14, fontWeight: 600 }}>
            {result.replacedCount > 0
              ? `Replaced ${result.replacedCount} old draft game(s) — `
              : ''}
            Created {result.gamesCreated} games across {result.weeksScheduled} round(s).
            {result.conflictsAvoided > 0 &&
              ` Skipped ${result.conflictsAvoided} slot(s) already booked by another event.`}
            {result.blackoutsSkipped > 0 &&
              ` Skipped ${result.blackoutsSkipped} slot(s) blocked by a blackout.`}
            {result.fieldsReserved > 0 &&
              ` Skipped ${result.fieldsReserved} slot(s) reserved for a higher-priority division that hasn't been scheduled there yet.`}
            {result.coachConflictsAvoided > 0 &&
              ` Skipped ${result.coachConflictsAvoided} slot(s) that would have double-booked a coach on another team.`}
            {result.weeklyCapDeferred > 0 &&
              ` Pushed ${result.weeklyCapDeferred} game(s) to a later week to stay under the max-games-per-week limit.`}
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
        {submitting
          ? 'Generating…'
          : draftGameCount > 0
          ? `Regenerate schedule for ${divisionName}`
          : `Generate schedule for ${divisionName}`}
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
