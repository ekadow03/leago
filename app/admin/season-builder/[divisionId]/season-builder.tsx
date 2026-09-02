// app/admin/season-builder/[divisionId]/season-builder.tsx
'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { generateSeasonSchedule } from '@/lib/actions/auto-schedule';
import { createField } from '@/lib/actions/fields';
import { createBlackout, deleteBlackout } from '@/lib/actions/blackouts';
import { createEvent } from '@/lib/actions/events';

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
  end_date: string | null;
  days_of_week: number[] | null;
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
} {
  const activeDays = Array.from(new Set(slots.map((s) => s.dayOfWeek))).sort((a, b) => a - b);
  const daySlots: Record<number, TimeGroup[]> = {};
  for (const slot of slots) {
    const groups = daySlots[slot.dayOfWeek] ?? (daySlots[slot.dayOfWeek] = []);
    let group = groups.find((g) => g.time === slot.time);
    if (!group) {
      group = { time: slot.time, fields: [] };
      groups.push(group);
    }
    if (!group.fields.includes(slot.field)) group.fields.push(slot.field);
  }
  for (const day of Object.keys(daySlots)) {
    daySlots[Number(day)].sort((a, b) => a.time.localeCompare(b.time));
  }
  return { activeDays, daySlots };
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
  draftGameCount,
  publishedGameCount,
  orgFields,
  initialBlackouts,
  initialFieldNames,
  initialSettings,
  settingsLoadError,
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
  settingsLoadError: string | null;
}) {
  return (
    <div>
      <TeamSummary teams={initialTeams} />
      <ScheduleGenerator
        organizationId={organizationId}
        seasonId={seasonId}
        divisionId={divisionId}
        divisionName={divisionName}
        teams={initialTeams}
        teamCount={initialTeams.length}
        draftGameCount={draftGameCount}
        publishedGameCount={publishedGameCount}
        orgFields={orgFields}
        initialBlackouts={initialBlackouts}
        initialFieldNames={initialFieldNames}
        initialSettings={initialSettings}
        settingsLoadError={settingsLoadError}
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
  teams,
  teamCount,
  draftGameCount,
  publishedGameCount,
  orgFields,
  initialBlackouts,
  initialFieldNames,
  initialSettings,
  settingsLoadError,
}: {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  divisionName: string;
  teams: Team[];
  teamCount: number;
  draftGameCount: number;
  publishedGameCount: number;
  orgFields: OrgField[];
  initialBlackouts: Blackout[];
  initialFieldNames: string[];
  initialSettings: SavedSettings | null;
  settingsLoadError: string | null;
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
  interface UnplacedMatchup {
    homeTeamId: string;
    awayTeamId: string;
    candidateSlots: { startTime: string; field: string; weekNumber: number }[];
  }
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
    unplacedMatchups: UnplacedMatchup[];
    settingsSaveWarning?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Matchups the admin has already scheduled from the "unplaced" list
  // below (by team-pair key) — removed from view immediately rather
  // than waiting on a full page refresh.
  const [scheduledUnplaced, setScheduledUnplaced] = useState<Set<number>>(new Set());
  const [schedulingKey, setSchedulingKey] = useState<string | null>(null);
  const [scheduleUnplacedError, setScheduleUnplacedError] = useState<string | null>(null);

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

  const teamById = new Map(teams.map((t) => [t.id, t.name]));

  async function handleGenerate() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    setScheduledUnplaced(new Set());
    setScheduleUnplacedError(null);
    try {
      const flatSlots = Object.entries(daySlots).flatMap(([day, groups]) =>
        groups.flatMap((g) =>
          g.fields.map((field) => ({
            dayOfWeek: Number(day),
            time: g.time,
            field,
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

  // Places one unplaced matchup into one of its suggested open slots —
  // the "or offer open spots for the user to pick" half of the
  // leftover-matchup handling. Uses the exact same createEvent() path as
  // the manual "+ Add event" form on the Schedule page, so it gets the
  // same coach-conflict safety net; a conflict here (unlikely, since the
  // suggestion was already checked at generation time, but another game
  // could've been added in between) just points the admin at that form
  // instead of silently forcing it through.
  async function handleScheduleUnplaced(
    index: number,
    matchup: { homeTeamId: string; awayTeamId: string },
    slot: { startTime: string; field: string; weekNumber: number }
  ) {
    setSchedulingKey(String(index));
    setScheduleUnplacedError(null);
    try {
      const endTime = new Date(new Date(slot.startTime).getTime() + gameDurationNum * 60000).toISOString();
      const res = await createEvent({
        organizationId,
        seasonId,
        divisionId,
        type: 'game',
        title: 'Game',
        location: slot.field,
        startTime: slot.startTime,
        endTime,
        homeTeamId: matchup.homeTeamId,
        awayTeamId: matchup.awayTeamId,
        weekNumber: slot.weekNumber,
      });
      if ('conflicts' in res) {
        setScheduleUnplacedError(
          "That slot now double-books a coach — use \"+ Add event\" on the Schedule page instead, which lets you confirm and create it anyway."
        );
        return;
      }
      if ('error' in res) {
        setScheduleUnplacedError(res.error);
        return;
      }
      setScheduledUnplaced((prev) => new Set(prev).add(index));
    } catch (err: any) {
      setScheduleUnplacedError(err.message);
    } finally {
      setSchedulingKey(null);
    }
  }

  const remainingUnplacedMatchups = (result?.unplacedMatchups ?? [])
    .map((m, i) => ({ ...m, index: i }))
    .filter((m) => !scheduledUnplaced.has(m.index));

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

      {settingsLoadError && (
        <p style={{ fontSize: 13, color: '#B23A2E', background: 'rgba(178,58,46,0.1)', padding: '8px 12px', borderRadius: 8, marginBottom: 16 }}>
          Couldn&apos;t load your last-used settings for this division, so the form below is starting blank
          instead of restoring what you generated with before — anything you generate now will still save fine.
          Error: {settingsLoadError}
        </p>
      )}

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
          Every active day draws from the same pool of matchups, in the order a fair round-robin needs them —
          there&apos;s no separate weekday/weekend track to keep in sync. A day with more open slots (a typical
          Saturday, say) naturally ends up carrying more games than a weekday with just one slot, and a
          blacked-out or fully-booked day just means fewer chances that day, not a lost game — it&apos;s tried
          again on the next day that has room.
        </p>
      )}

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
            Created {result.gamesCreated} games across {result.weeksScheduled} week(s).
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
              Heads up: not every team reached {gamesPerTeamNum} games before the end date. See the matchups
              below, or add more times/fields, extend the end date, or lower the games-per-team target and
              regenerate.
            </p>
          )}
          {result.settingsSaveWarning && (
            <p style={{ color: '#B23A2E', fontSize: 13, marginTop: -4 }}>
              Heads up: the games above were created fine, but your inputs weren&apos;t saved for next visit —
              you&apos;ll need to re-enter them if you come back later. Error: {result.settingsSaveWarning}
            </p>
          )}

          {remainingUnplacedMatchups.length > 0 && (
            <div style={{ marginTop: 16, marginBottom: 4 }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                {remainingUnplacedMatchups.length} matchup(s) still need a game and didn&apos;t fit anywhere in
                the date range:
              </p>
              <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 0, marginBottom: 10 }}>
                Each one below has a few real open slots — a week where neither team already has a game — that
                clear every conflict a normal placement would. Pick one to schedule it as a draft game, or use{' '}
                <Link href="/admin/schedule" style={{ color: 'var(--green-dark)' }}>
                  + Add event
                </Link>{' '}
                on the Schedule page for anything else.
              </p>
              {scheduleUnplacedError && <p style={{ color: '#B23A2E', fontSize: 13 }}>{scheduleUnplacedError}</p>}
              <div className="data-table-card">
                {remainingUnplacedMatchups.map((m) => (
                  <div
                    key={m.index}
                    className="data-row"
                    style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}
                  >
                    <div className="data-row-name">
                      {teamById.get(m.homeTeamId) ?? 'Unknown team'} vs {teamById.get(m.awayTeamId) ?? 'Unknown team'}
                    </div>
                    {m.candidateSlots.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--gray)', margin: 0 }}>
                        No open slot found for either team — try adding more times/fields or extending the end
                        date.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {m.candidateSlots.map((slot, si) => (
                          <button
                            key={si}
                            type="button"
                            className="btn-small"
                            disabled={schedulingKey === String(m.index)}
                            onClick={() => handleScheduleUnplaced(m.index, m, slot)}
                          >
                            {schedulingKey === String(m.index)
                              ? 'Scheduling…'
                              : `${new Date(slot.startTime).toLocaleString(undefined, {
                                  weekday: 'short',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })} · ${slot.field}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
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

function formatShortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function describeBlackout(b: Blackout): string {
  const timeRange = b.start_time && b.end_time ? `${formatTime12h(b.start_time)}–${formatTime12h(b.end_time)}` : 'All day';
  const field = b.field_name ? b.field_name : 'All fields';
  let when: string;
  if (b.kind === 'date' && b.blackout_date && b.end_date) {
    const dayRestriction =
      b.days_of_week && b.days_of_week.length > 0 && b.days_of_week.length < 7
        ? ` (${b.days_of_week
            .slice()
            .sort((a, c) => a - c)
            .map((d) => DAY_NAMES[d].slice(0, 3))
            .join(', ')} only)`
        : '';
    when = `${formatShortDate(b.blackout_date)} – ${formatShortDate(b.end_date)}${dayRestriction}`;
  } else if (b.kind === 'date' && b.blackout_date) {
    when = formatShortDate(b.blackout_date);
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
  const [endDate, setEndDate] = useState('');
  const [daysOfWeek, setDaysOfWeek] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [dayOfWeek, setDayOfWeek] = useState('0');
  const [fullDay, setFullDay] = useState(true);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  // Empty = every field (today's "All fields" behavior). One row still
  // only ever names one field (see migration 0017) — picking more than
  // one here just submits multiple rows, one per field, all sharing the
  // same date/time/label, rather than changing how a row is stored.
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDayOfWeek(day: number) {
    setDaysOfWeek((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function toggleField(name: string) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const isRange = kind === 'date' && endDate.trim() !== '';
      const daysOfWeekArray = isRange && daysOfWeek.size < 7 ? Array.from(daysOfWeek).sort((a, b) => a - b) : undefined;
      // None checked = every field (today's "All fields" row, field_name
      // null). Otherwise submit one row per checked field, one at a
      // time, so a failure partway through still keeps whatever already
      // succeeded instead of losing it.
      const fieldsToApply: (string | null)[] = selectedFields.size > 0 ? Array.from(selectedFields) : [null];
      const created: Blackout[] = [];
      for (const field of fieldsToApply) {
        const result = await createBlackout({
          organizationId,
          seasonId,
          kind,
          fieldName: field ?? undefined,
          blackoutDate: kind === 'date' ? blackoutDate : undefined,
          endDate: isRange ? endDate : undefined,
          daysOfWeek: daysOfWeekArray,
          dayOfWeek: kind === 'weekly' ? Number(dayOfWeek) : undefined,
          startTime: fullDay ? undefined : startTime || undefined,
          endTime: fullDay ? undefined : endTime || undefined,
          label: label || undefined,
        });
        if ('error' in result) {
          for (const row of created) onAdded(row);
          setError(
            created.length > 0
              ? `Added ${created.length} of ${fieldsToApply.length} field(s) before this one failed: ${result.error}`
              : result.error
          );
          return;
        }
        created.push({
          id: result.id,
          season_id: seasonId,
          field_name: field,
          kind,
          blackout_date: kind === 'date' ? blackoutDate : null,
          end_date: isRange ? endDate : null,
          days_of_week: daysOfWeekArray && daysOfWeekArray.length > 0 ? daysOfWeekArray : null,
          day_of_week: kind === 'weekly' ? Number(dayOfWeek) : null,
          start_time: fullDay ? null : startTime || null,
          end_time: fullDay ? null : endTime || null,
          label: label.trim() || null,
        });
      }
      for (const row of created) onAdded(row);
      setBlackoutDate('');
      setEndDate('');
      setDaysOfWeek(new Set([0, 1, 2, 3, 4, 5, 6]));
      setStartTime('');
      setEndTime('');
      setSelectedFields(new Set());
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
            <option value="date">Specific date, or a date range (e.g. a holiday, or a stretch of the season)</option>
            <option value="weekly">Same day every week this season</option>
            <option value="daily">Every day this season</option>
          </select>

          {kind === 'date' && (
            <>
              <label className="form-label">{endDate ? 'Start date' : 'Date'}</label>
              <input
                type="date"
                value={blackoutDate}
                onChange={(e) => setBlackoutDate(e.target.value)}
                className="form-input"
                required
              />

              <label className="form-label">End date (optional — leave blank for a single day)</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="form-input"
                min={blackoutDate || undefined}
              />

              {endDate && (
                <>
                  <label className="form-label">Days within that range (uncheck to restrict, e.g. weekdays only)</label>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '4px 0 12px' }}>
                    {DAY_NAMES.map((name, i) => (
                      <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                        <input type="checkbox" checked={daysOfWeek.has(i)} onChange={() => toggleDayOfWeek(i)} />
                        {name.slice(0, 3)}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <button
                      type="button"
                      onClick={() => setDaysOfWeek(new Set([0, 1, 2, 3, 4, 5, 6]))}
                      className="btn-small"
                    >
                      Every day
                    </button>
                    <button
                      type="button"
                      onClick={() => setDaysOfWeek(new Set([1, 2, 3, 4, 5]))}
                      className="btn-small"
                    >
                      Weekdays only
                    </button>
                    <button
                      type="button"
                      onClick={() => setDaysOfWeek(new Set([0, 6]))}
                      className="btn-small"
                    >
                      Weekends only
                    </button>
                  </div>
                </>
              )}
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

          <label className="form-label">Fields</label>
          <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -8, marginBottom: 8 }}>
            Leave none checked to block every field. Check more than one to apply the same blackout to each of
            them at once (e.g. every field closed for a holiday, or two fields both losing daylight).
          </p>
          {fields.length > 0 ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '4px 0 12px' }}>
              {fields.map((f) => (
                <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <input type="checkbox" checked={selectedFields.has(f.name)} onChange={() => toggleField(f.name)} />
                  {f.name}
                </label>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 12 }}>No fields set up yet.</p>
          )}

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
