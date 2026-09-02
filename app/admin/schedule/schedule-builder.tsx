// app/admin/schedule/schedule-builder.tsx
'use client';

import { useState } from 'react';
import { createEvent, setEventStatus, publishAllDraftEvents, deleteEvent, deleteEvents, updateEvent } from '@/lib/actions/events';
import type { CoachConflict } from '@/lib/scheduling-conflicts';

function describeConflicts(conflicts: CoachConflict[]): string {
  const lines = conflicts.map(
    (c) =>
      `${c.personName} is already coaching "${c.conflictingEventTitle}" at ${new Date(c.conflictingStart).toLocaleString()}.`
  );
  return `This double-books a coach:\n\n${lines.join('\n')}\n\nCreate it anyway?`;
}

interface Season {
  id: string;
  name: string;
}

interface Division {
  id: string;
  name: string;
  season_id: string;
}

interface Team {
  id: string;
  name: string;
  division_id: string;
  divisions?: { name: string } | null;
}

// Mirrors the shape auto-schedule.ts's generator reads/writes — see
// migrations 0019/0024. Loaded here (read-only) so the schedule page can
// show open slots from the same field/day/time grid the generator used,
// without the admin having to re-describe it.
interface DaySlot {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  time: string; // "18:00" etc — 24hr
  field: string;
}

interface DivisionScheduleSettingsRow {
  division_id: string;
  day_slots: DaySlot[];
  games_per_team: number;
  game_duration_minutes: number;
  start_date: string;
  end_date: string;
  week_start_day: number;
  max_games_per_week: number | null;
}

// Same shape as auto-schedule.ts's BlackoutRow (migration 0017/0025).
interface BlackoutRow {
  season_id: string;
  field_name: string | null;
  kind: 'date' | 'weekly' | 'daily';
  blackout_date: string | null;
  end_date: string | null;
  days_of_week: number[] | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
}

// A configured field/day/time slot that doesn't have a game in it yet —
// computed client-side from DivisionScheduleSettingsRow + BlackoutRow,
// the same inputs/logic generateSeasonSchedule() itself walks.
interface OpenSlot {
  key: string;
  date: Date;
  time: string;
  field: string;
  startTimeIso: string;
  weekNumber: number;
}

interface EventRow {
  id: string;
  type: string;
  title: string;
  location: string | null;
  start_time: string;
  end_time: string | null;
  status: string;
  season_id: string | null;
  division_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  week_number: number | null;
}

const EVENT_TYPES = [
  { value: 'game', label: 'Game' },
  { value: 'practice', label: 'Practice' },
  { value: 'volunteer_shift', label: 'Volunteer Shift' },
  { value: 'league_event', label: 'League Event' },
] as const;

function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- Open-slot helpers, ported from lib/actions/auto-schedule.ts ----
// (that file is 'use server', so its internals can't be imported into a
// client component — these mirror its logic exactly; keep them in sync
// if that file's slot/blackout handling ever changes).

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKeyLocal(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getWeekKeyLocal(date: Date, weekStartDay: number): string {
  const diff = (date.getDay() - weekStartDay + 7) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(weekStart.getDate() - diff);
  return `${weekStart.getFullYear()}-${pad2(weekStart.getMonth() + 1)}-${pad2(weekStart.getDate())}`;
}

// Converts a calendar date + wall-clock "HH:MM" into the correct UTC
// instant for a given IANA timezone — same round-trip technique as
// auto-schedule.ts's zonedDateTimeToIso.
function zonedDateTimeToIso(date: Date, time: string, timeZone: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  const guessMs = Date.UTC(year, month, day, hours, minutes, 0);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(guessMs))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  const renderedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    parts.hour === '24' ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  const offsetMs = renderedAsUtc - guessMs;
  return new Date(guessMs - offsetMs).toISOString();
}

function isSlotBlackedOut(date: Date, time: string, field: string, blackouts: BlackoutRow[], timeZone: string): boolean {
  if (blackouts.length === 0) return false;

  const dateStr = dateKeyLocal(date);
  const slotMs = new Date(zonedDateTimeToIso(date, time, timeZone)).getTime();

  for (const b of blackouts) {
    if (b.field_name && b.field_name.toLowerCase() !== field.toLowerCase()) continue;

    let dayMatches = false;
    if (b.kind === 'date' && b.end_date) {
      dayMatches =
        dateStr >= b.blackout_date! &&
        dateStr <= b.end_date &&
        (!b.days_of_week || b.days_of_week.length === 0 || b.days_of_week.includes(date.getDay()));
    } else if (b.kind === 'date') {
      dayMatches = b.blackout_date === dateStr;
    } else if (b.kind === 'weekly') {
      dayMatches = b.day_of_week === date.getDay();
    } else if (b.kind === 'daily') {
      dayMatches = true;
    }
    if (!dayMatches) continue;

    if (!b.start_time || !b.end_time) return true;

    const startMs = new Date(zonedDateTimeToIso(date, b.start_time, timeZone)).getTime();
    const endMs = new Date(zonedDateTimeToIso(date, b.end_time, timeZone)).getTime();
    if (slotMs >= startMs && slotMs < endMs) return true;
  }

  return false;
}

// GameChanger's League Bulk Schedule Import expects date/time/home/away/
// location/duration columns, with time as "6:00 PM" (no seconds, no 24hr)
// and duration as a plain integer count of minutes — see
// help.gc.com/hc/en-us/articles/8780588516365. GameChanger doesn't
// publish the exact date format alongside that, so this uses the
// standard US MM/DD/YYYY convention; if their import rejects it, the
// live template downloaded from your GameChanger organization's admin
// portal is the authoritative source to match against.
function formatDateForGameChanger(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

function formatTimeForGameChanger(iso: string): string {
  const d = new Date(iso);
  const hours = d.getHours();
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(d.getMinutes()).padStart(2, '0')} ${period}`;
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// SportConnect Download's League Bulk Import expects
// SortOrder/RoundNo/HomeTeam/AwayTeam/MatchDate/StartTime/EndTime/
// Location/Field columns — MatchDate as unpadded M/D/YYYY (e.g. "11/9/2011",
// not "11/09/2011"), and Start/EndTime as 24-hour HH:MM (not AM/PM like
// GameChanger's format). Location and Field are separate columns there
// (a venue, and a specific field/court within it) where this app only
// tracks one field name per game — see handleExportSportConnect() for how
// that's bridged.
function formatDateForSportConnect(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function formatTime24hForSportConnect(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ScheduleBuilder({
  organizationId,
  organizationName,
  seasons,
  divisions,
  teams,
  initialEvents,
  scheduleSettings,
  blackouts,
}: {
  organizationId: string;
  organizationName: string;
  seasons: Season[];
  divisions: Division[];
  teams: Team[];
  initialEvents: EventRow[];
  scheduleSettings: DivisionScheduleSettingsRow[];
  blackouts: BlackoutRow[];
}) {
  const [events, setEvents] = useState(initialEvents);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState(seasons[0]?.id ?? '');
  const [selectedDivisionId, setSelectedDivisionId] = useState('');

  const [type, setType] = useState<'game' | 'practice' | 'volunteer_shift' | 'league_event'>('game');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startTime, setStartTime] = useState('');
  const [homeTeamId, setHomeTeamId] = useState('');
  const [awayTeamId, setAwayTeamId] = useState('');
  const [weekNumber, setWeekNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showBalanceReport, setShowBalanceReport] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editHomeTeamId, setEditHomeTeamId] = useState('');
  const [editAwayTeamId, setEditAwayTeamId] = useState('');
  const [editWeekNumber, setEditWeekNumber] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Drag-and-drop for draft events: draggedId is the event currently
  // being dragged; dragOverWeekKey highlights whichever week section
  // it's hovering (undefined = none — null is itself a valid week key,
  // for the 'Unscheduled' bucket, so it can't double as 'no hover').
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverWeekKey, setDragOverWeekKey] = useState<number | null | undefined>(undefined);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);

  // Open slots: a toggleable view of a single division's configured
  // field/day/time grid (from its last schedule-generator run) with
  // already-used slots subtracted out, so an admin can see gaps and fill
  // them by dragging an existing draft game there, or by dragging in a
  // team that hasn't hit its target game count yet and picking an
  // opponent.
  const [showOpenSlots, setShowOpenSlots] = useState(false);
  const [draggedTeamId, setDraggedTeamId] = useState<string | null>(null);
  // slot key -> team dropped in as the proposed home team, awaiting an
  // opponent pick before a game actually gets created.
  const [slotDraftHome, setSlotDraftHome] = useState<Record<string, string>>({});
  const [slotOpponentChoice, setSlotOpponentChoice] = useState<Record<string, string>>({});
  const [creatingSlotKey, setCreatingSlotKey] = useState<string | null>(null);

  const divisionsForSeason = divisions.filter((d) => d.season_id === selectedSeasonId);

  // Teams offered in the manual "Add event"/edit-event team pickers —
  // scoped to a single division when one is known (the top filter for
  // creating, or the event's own division when editing), since that's
  // overwhelmingly the common case (e.g. adding one extra makeup/bonus
  // game between two teams already in view) and a multi-division org
  // can easily have dozens of teams across the whole organization. With
  // no single division to scope to (e.g. "All divisions" selected while
  // creating), every team for the current season is offered instead,
  // grouped by division so it's still easy to scan.
  const teamsForSeason = teams.filter((t) => divisionsForSeason.some((d) => d.id === t.division_id));

  function renderTeamOptions(scopeDivisionId: string | null) {
    if (scopeDivisionId) {
      return teamsForSeason
        .filter((t) => t.division_id === scopeDivisionId)
        .map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ));
    }
    const byDivision = new Map<string, Team[]>();
    for (const t of teamsForSeason) {
      const label = t.divisions?.name ?? 'Other';
      const list = byDivision.get(label) ?? [];
      list.push(t);
      byDivision.set(label, list);
    }
    return Array.from(byDivision.entries()).map(([divisionName, divTeams]) => (
      <optgroup key={divisionName} label={divisionName}>
        {divTeams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </optgroup>
    ));
  }

  const filteredEvents = events.filter(
    (ev) => ev.season_id === selectedSeasonId && (!selectedDivisionId || ev.division_id === selectedDivisionId)
  );

  // Group by week_number so admins reviewing an archived schedule can scan
  // it week-by-week rather than as one long date-ordered list. Events with
  // no week_number (manually added, or created before this feature) fall
  // into an "Unscheduled" bucket at the end.
  const weekGroups = new Map<number | null, EventRow[]>();
  for (const ev of filteredEvents) {
    const key = ev.week_number ?? null;
    if (!weekGroups.has(key)) weekGroups.set(key, []);
    weekGroups.get(key)!.push(ev);
  }
  // Open slots (see the toggle button below): every configured field/
  // day/time slot for the selected division's season, minus anything
  // already blacked out or already occupied by a non-canceled event
  // anywhere in the org (fields can be shared across divisions — see
  // migration 0018 — so another division's game on that field at that
  // instant counts as taken too). Only computed when a single division
  // is picked and its schedule generator has been run at least once
  // (that's what schedule_generation_settings requires).
  const selectedDivisionSettings = selectedDivisionId
    ? scheduleSettings.find((s) => s.division_id === selectedDivisionId) ?? null
    : null;

  const openSlots: OpenSlot[] = [];
  let shortTeams: { teamId: string; teamName: string; needed: number }[] = [];

  if (showOpenSlots && selectedDivisionId && selectedDivisionSettings) {
    const settings = selectedDivisionSettings;
    const timeZone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

    const slotsByDay = new Map<number, DaySlot[]>();
    for (const slot of settings.day_slots ?? []) {
      const list = slotsByDay.get(slot.dayOfWeek) ?? [];
      list.push(slot);
      slotsByDay.set(slot.dayOfWeek, list);
    }
    for (const list of slotsByDay.values()) list.sort((a, b) => a.time.localeCompare(b.time));

    const gameDates: Date[] = [];
    const cursor = new Date(settings.start_date + 'T00:00:00');
    const end = new Date(settings.end_date + 'T00:00:00');
    while (cursor <= end) {
      if (slotsByDay.has(cursor.getDay())) gameDates.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    // Same 1-based, chronological week numbering generateSeasonSchedule()
    // itself stamps onto week_number, so open slots land in the same
    // week sections as the real games already there.
    const weekNumberByDateKey = new Map<string, number>();
    {
      let nextWeekNumber = 0;
      let lastWeekKey: string | null = null;
      for (const date of gameDates) {
        const wk = getWeekKeyLocal(date, settings.week_start_day);
        if (wk !== lastWeekKey) {
          nextWeekNumber++;
          lastWeekKey = wk;
        }
        weekNumberByDateKey.set(dateKeyLocal(date), nextWeekNumber);
      }
    }

    const divisionSeasonId = divisions.find((d) => d.id === selectedDivisionId)?.season_id ?? selectedSeasonId;
    const divisionBlackouts = blackouts.filter((b) => b.season_id === divisionSeasonId);

    const occupied = new Set<string>();
    for (const ev of events) {
      if (ev.status === 'canceled' || !ev.location) continue;
      occupied.add(`${ev.start_time}|${ev.location.toLowerCase()}`);
    }

    for (const date of gameDates) {
      const slots = slotsByDay.get(date.getDay()) ?? [];
      for (const slot of slots) {
        if (isSlotBlackedOut(date, slot.time, slot.field, divisionBlackouts, timeZone)) continue;
        const startTimeIso = zonedDateTimeToIso(date, slot.time, timeZone);
        if (occupied.has(`${startTimeIso}|${slot.field.toLowerCase()}`)) continue;
        openSlots.push({
          key: `${selectedDivisionId}|${dateKeyLocal(date)}|${slot.time}|${slot.field}`,
          date,
          time: slot.time,
          field: slot.field,
          startTimeIso,
          weekNumber: weekNumberByDateKey.get(dateKeyLocal(date)) ?? 0,
        });
      }
    }

    const gameCounts = new Map<string, number>();
    for (const ev of events) {
      if (ev.division_id !== selectedDivisionId || ev.type !== 'game' || ev.status === 'canceled') continue;
      if (ev.home_team_id) gameCounts.set(ev.home_team_id, (gameCounts.get(ev.home_team_id) ?? 0) + 1);
      if (ev.away_team_id) gameCounts.set(ev.away_team_id, (gameCounts.get(ev.away_team_id) ?? 0) + 1);
    }
    shortTeams = teams
      .filter((t) => t.division_id === selectedDivisionId)
      .map((t) => ({ teamId: t.id, teamName: t.name, needed: settings.games_per_team - (gameCounts.get(t.id) ?? 0) }))
      .filter((t) => t.needed > 0)
      .sort((a, b) => b.needed - a.needed);
  }

  const openSlotsByWeek = new Map<number, OpenSlot[]>();
  for (const slot of openSlots) {
    const list = openSlotsByWeek.get(slot.weekNumber) ?? [];
    list.push(slot);
    openSlotsByWeek.set(slot.weekNumber, list);
  }
  for (const list of openSlotsByWeek.values()) list.sort((a, b) => a.startTimeIso.localeCompare(b.startTimeIso));

  const sortedWeekKeys = Array.from(new Set<number | null>([...weekGroups.keys(), ...openSlotsByWeek.keys()])).sort(
    (a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    }
  );

  // Quick balance check: is every team getting a roughly even split of
  // home vs. away games, and is each team facing every other team in its
  // division a similar number of times? Some drift is legitimate (an odd
  // number of teams leaves someone with an extra home or away game; a
  // manually-added bonus game — see the "+ Add event" hint below — adds
  // one extra matchup on purpose) so this is presented as something to
  // eyeball, not a hard error.
  interface BalanceRow {
    teamId: string;
    teamName: string;
    home: number;
    away: number;
  }
  interface MatchupCount {
    teamAId: string;
    teamAName: string;
    teamBId: string;
    teamBName: string;
    count: number;
  }
  interface DivisionBalance {
    divisionId: string;
    divisionName: string;
    rows: BalanceRow[];
    matchups: MatchupCount[];
    matchupMedian: number;
  }

  const balanceGameEvents = filteredEvents.filter(
    (ev) => ev.type === 'game' && ev.status !== 'canceled' && ev.home_team_id && ev.away_team_id
  );
  const balanceDivisionIds = selectedDivisionId ? [selectedDivisionId] : divisionsForSeason.map((d) => d.id);

  const divisionBalances: DivisionBalance[] = balanceDivisionIds
    .map((divId) => {
      const division = divisions.find((d) => d.id === divId);
      const divTeams = teams.filter((t) => t.division_id === divId).sort((a, b) => a.name.localeCompare(b.name));
      const homeCounts = new Map<string, number>();
      const awayCounts = new Map<string, number>();
      const pairCounts = new Map<string, number>();
      for (const ev of balanceGameEvents) {
        if (ev.division_id !== divId) continue;
        homeCounts.set(ev.home_team_id!, (homeCounts.get(ev.home_team_id!) ?? 0) + 1);
        awayCounts.set(ev.away_team_id!, (awayCounts.get(ev.away_team_id!) ?? 0) + 1);
        const pairKey = [ev.home_team_id!, ev.away_team_id!].sort().join('|');
        pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
      }
      const rows: BalanceRow[] = divTeams.map((t) => ({
        teamId: t.id,
        teamName: t.name,
        home: homeCounts.get(t.id) ?? 0,
        away: awayCounts.get(t.id) ?? 0,
      }));
      const matchups: MatchupCount[] = [];
      for (let i = 0; i < divTeams.length; i++) {
        for (let j = i + 1; j < divTeams.length; j++) {
          const pairKey = [divTeams[i].id, divTeams[j].id].sort().join('|');
          matchups.push({
            teamAId: divTeams[i].id,
            teamAName: divTeams[i].name,
            teamBId: divTeams[j].id,
            teamBName: divTeams[j].name,
            count: pairCounts.get(pairKey) ?? 0,
          });
        }
      }
      const sortedCounts = matchups.map((m) => m.count).sort((a, b) => a - b);
      const matchupMedian = sortedCounts.length > 0 ? sortedCounts[Math.floor(sortedCounts.length / 2)] : 0;
      return {
        divisionId: divId,
        divisionName: division?.name ?? 'Unknown division',
        rows,
        matchups,
        matchupMedian,
      };
    })
    .filter((db) => db.rows.length > 0);

  function handleSeasonChange(seasonId: string) {
    setSelectedSeasonId(seasonId);
    setSelectedDivisionId('');
    setSelectedIds(new Set());
  }

  async function handleCreate(e: React.FormEvent, allowConflicts = false) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const weekNumberNum = weekNumber.trim() === '' ? undefined : Number(weekNumber);
      const result = await createEvent({
        organizationId,
        seasonId: selectedSeasonId || undefined,
        divisionId: selectedDivisionId || undefined,
        type,
        title,
        location: location || undefined,
        startTime: new Date(startTime).toISOString(),
        homeTeamId: type === 'game' ? homeTeamId || undefined : undefined,
        awayTeamId: type === 'game' ? awayTeamId || undefined : undefined,
        weekNumber: type === 'game' ? weekNumberNum : undefined,
        allowConflicts,
      });
      if ('conflicts' in result) {
        setSubmitting(false);
        if (confirm(describeConflicts(result.conflicts))) {
          handleCreate(e, true);
        }
        return;
      }
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) => [
        ...prev,
        {
          id: result.id,
          type,
          title,
          location: location || null,
          start_time: new Date(startTime).toISOString(),
          end_time: null,
          status: 'draft',
          season_id: selectedSeasonId || null,
          division_id: selectedDivisionId || null,
          home_team_id: homeTeamId || null,
          away_team_id: awayTeamId || null,
          week_number: type === 'game' ? weekNumberNum ?? null : null,
        },
      ].sort((a, b) => a.start_time.localeCompare(b.start_time)));
      setTitle('');
      setLocation('');
      setStartTime('');
      setHomeTeamId('');
      setAwayTeamId('');
      setWeekNumber('');
      setShowForm(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleStatus(eventId: string, newStatus: 'draft' | 'published' | 'canceled') {
    setError(null);
    try {
      const result = await setEventStatus(organizationId, eventId, newStatus);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, status: newStatus } : ev)));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDelete(eventId: string) {
    if (!confirm('Delete this event?')) return;
    setError(null);
    try {
      const result = await deleteEvent(organizationId, eventId);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) => prev.filter((ev) => ev.id !== eventId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
    } catch (err: any) {
      setError(err.message);
    }
  }

  function toggleSelected(eventId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const visibleIds = filteredEvents.map((ev) => ev.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected event(s)? This can't be undone.`)) return;
    setError(null);
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await deleteEvents(organizationId, ids);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) => prev.filter((ev) => !selectedIds.has(ev.id)));
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handlePublishAll() {
    if (!selectedSeasonId) return;
    setError(null);
    try {
      const result = await publishAllDraftEvents(organizationId, selectedSeasonId);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) =>
        prev.map((ev) => (ev.season_id === selectedSeasonId && ev.status === 'draft' ? { ...ev, status: 'published' } : ev))
      );
      alert(`Published ${result.count} event(s).`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  // Exports whatever is currently filtered (season, and division if one
  // is picked) as a CSV for GameChanger's League Bulk Schedule Import.
  // Only 'game' events with both a home and away team assigned can go in
  // — GameChanger's import has no division/practice concept, it's just
  // games between two teams already in your GameChanger org roster.
  function handleExportGameChanger() {
    const gameEvents = filteredEvents.filter(
      (ev) => ev.type === 'game' && ev.home_team_id && ev.away_team_id
    );
    const skipped = filteredEvents.length - gameEvents.length;

    if (gameEvents.length === 0) {
      alert('No games with both a home and away team set in the current view — pick a season/division with a generated schedule first.');
      return;
    }

    // Games generated with a game duration already carry their own
    // end_time (see the "Game duration" field on the schedule generator),
    // so use that game's own start/end gap when it's there. Only games
    // created before that field existed (or added manually without an
    // end time) fall back to a single duration applied to all of them.
    const missingDuration = gameEvents.some((ev) => !ev.end_time);
    let fallbackDuration = 60;
    if (missingDuration) {
      const durationInput = prompt(
        'Some games have no stored duration (created before the game-duration field, or added manually). ' +
          'Enter a duration in minutes to use for those:',
        '60'
      );
      if (durationInput === null) return;
      fallbackDuration = Math.round(Number(durationInput));
      if (!Number.isFinite(fallbackDuration) || fallbackDuration <= 0) {
        alert('Enter a whole number of minutes greater than 0.');
        return;
      }
    }
    function durationFor(ev: EventRow): number {
      if (ev.end_time) {
        const mins = Math.round((new Date(ev.end_time).getTime() - new Date(ev.start_time).getTime()) / 60000);
        if (mins > 0) return mins;
      }
      return fallbackDuration;
    }

    // GameChanger matches teams by name only (no division field in its
    // import), so two teams sharing a name across different divisions
    // would be ambiguous on their end — flag it rather than silently
    // exporting something that could land on the wrong team.
    const usedTeamIds = new Set<string>();
    gameEvents.forEach((ev) => {
      if (ev.home_team_id) usedTeamIds.add(ev.home_team_id);
      if (ev.away_team_id) usedTeamIds.add(ev.away_team_id);
    });
    const nameCounts = new Map<string, number>();
    teams.forEach((t) => {
      if (usedTeamIds.has(t.id)) {
        nameCounts.set(t.name, (nameCounts.get(t.name) ?? 0) + 1);
      }
    });
    const duplicateNames = Array.from(nameCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name);

    const rows: string[][] = [['date', 'time', 'home', 'away', 'location', 'duration']];
    gameEvents.forEach((ev) => {
      rows.push([
        formatDateForGameChanger(ev.start_time),
        formatTimeForGameChanger(ev.start_time),
        teamName(ev.home_team_id),
        teamName(ev.away_team_id),
        ev.location ?? '',
        String(durationFor(ev)),
      ]);
    });

    const csv = rows.map((row) => row.map(csvField).join(',')).join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gamechanger-schedule-export.csv';
    a.click();
    URL.revokeObjectURL(url);

    const notes: string[] = [`Exported ${gameEvents.length} game(s).`];
    if (skipped > 0) {
      notes.push(`Skipped ${skipped} event(s) without both teams assigned (practices, league events, or games missing a team).`);
    }
    if (duplicateNames.length > 0) {
      notes.push(`Heads up — these team names appear more than once across your divisions, which GameChanger can't tell apart by name alone: ${duplicateNames.join(', ')}.`);
    }
    alert(notes.join(' '));
  }

  // Same source data as the GameChanger export, in SportConnect Download's
  // own column layout — see the format comment above
  // formatDateForSportConnect(). SportConnect splits a game's venue
  // (Location) from a specific field/court within it (Field), which this
  // app doesn't model separately — every game's stored field name (e.g.
  // "Field 1") goes in Field, and a venue name entered once at export time
  // is applied to every row's Location.
  function handleExportSportConnect() {
    const gameEvents = filteredEvents.filter(
      (ev) => ev.type === 'game' && ev.home_team_id && ev.away_team_id
    );
    const skipped = filteredEvents.length - gameEvents.length;

    if (gameEvents.length === 0) {
      alert('No games with both a home and away team set in the current view — pick a season/division with a generated schedule first.');
      return;
    }

    const venue = prompt(
      'Venue/location name for every exported game (SportConnect\'s Location column — leave blank if your ' +
        'league only tracks fields, not a venue name):',
      ''
    );
    if (venue === null) return;

    const missingDuration = gameEvents.some((ev) => !ev.end_time);
    let fallbackDuration = 60;
    if (missingDuration) {
      const durationInput = prompt(
        'Some games have no stored duration (created before the game-duration field, or added manually). ' +
          'Enter a duration in minutes to use for those:',
        '60'
      );
      if (durationInput === null) return;
      fallbackDuration = Math.round(Number(durationInput));
      if (!Number.isFinite(fallbackDuration) || fallbackDuration <= 0) {
        alert('Enter a whole number of minutes greater than 0.');
        return;
      }
    }
    function endTimeIsoFor(ev: EventRow): string {
      if (ev.end_time) return ev.end_time;
      return new Date(new Date(ev.start_time).getTime() + fallbackDuration * 60000).toISOString();
    }

    const rows: string[][] = [
      ['SortOrder', 'RoundNo', 'HomeTeam', 'AwayTeam', 'MatchDate', 'StartTime', 'EndTime', 'Location', 'Field'],
    ];
    gameEvents.forEach((ev, i) => {
      rows.push([
        String(i + 1),
        ev.week_number != null ? String(ev.week_number) : '',
        teamName(ev.home_team_id),
        teamName(ev.away_team_id),
        formatDateForSportConnect(ev.start_time),
        formatTime24hForSportConnect(ev.start_time),
        formatTime24hForSportConnect(endTimeIsoFor(ev)),
        venue,
        ev.location ?? '',
      ]);
    });

    const csv = rows.map((row) => row.map(csvField).join(',')).join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sportconnect-schedule-export.csv';
    a.click();
    URL.revokeObjectURL(url);

    const notes: string[] = [`Exported ${gameEvents.length} game(s).`];
    if (skipped > 0) {
      notes.push(`Skipped ${skipped} event(s) without both teams assigned (practices, league events, or games missing a team).`);
    }
    alert(notes.join(' '));
  }

  function startEdit(ev: EventRow) {
    setEditingId(ev.id);
    setEditTitle(ev.title);
    setEditLocation(ev.location ?? '');
    setEditStartTime(toDatetimeLocal(ev.start_time));
    setEditHomeTeamId(ev.home_team_id ?? '');
    setEditAwayTeamId(ev.away_team_id ?? '');
    setEditWeekNumber(ev.week_number != null ? String(ev.week_number) : '');
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function handleSaveEdit(eventId: string, allowConflicts = false) {
    setError(null);
    setSavingEdit(true);
    try {
      const weekNumberNum = editWeekNumber.trim() === '' ? null : Number(editWeekNumber);
      const result = await updateEvent({
        organizationId,
        eventId,
        title: editTitle,
        location: editLocation || null,
        startTime: new Date(editStartTime).toISOString(),
        homeTeamId: editHomeTeamId || null,
        awayTeamId: editAwayTeamId || null,
        weekNumber: Number.isFinite(weekNumberNum as number) ? weekNumberNum : null,
        allowConflicts,
      });
      if ('conflicts' in result) {
        setSavingEdit(false);
        if (confirm(describeConflicts(result.conflicts))) {
          handleSaveEdit(eventId, true);
        }
        return;
      }
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) =>
        prev
          .map((ev) =>
            ev.id === eventId
              ? {
                  ...ev,
                  title: editTitle,
                  location: editLocation || null,
                  start_time: new Date(editStartTime).toISOString(),
                  home_team_id: editHomeTeamId || null,
                  away_team_id: editAwayTeamId || null,
                  week_number: weekNumberNum,
                }
              : ev
          )
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
      );
      setEditingId(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  function teamName(teamId: string | null) {
    return teams.find((t) => t.id === teamId)?.name ?? '';
  }

  // Drag-and-drop for draft events: drag one onto a different week's
  // section below to reassign its week_number only (the actual date/time
  // is left untouched — week_number is already just a display label, see
  // the grouping comment above), or drop it directly onto another draft
  // game to swap which teams are assigned to each (fixes "these two got
  // paired backwards" without retyping team names). Published games are
  // left out entirely — those are already visible to coaches/parents, so
  // moving them stays a deliberate action through the Edit form, which
  // runs the same conflict check either way.
  async function updateWithConflictConfirm(
    patch: Parameters<typeof updateEvent>[0]
  ): Promise<{ ok: true } | { error: string } | { cancelled: true }> {
    const result = await updateEvent(patch);
    if ('conflicts' in result) {
      if (confirm(describeConflicts(result.conflicts))) {
        return updateWithConflictConfirm({ ...patch, allowConflicts: true });
      }
      return { cancelled: true };
    }
    return result;
  }

  async function moveToWeek(eventId: string, weekKey: number | null) {
    setError(null);
    const previousWeek = events.find((ev) => ev.id === eventId)?.week_number ?? null;
    // Optimistic: show the move immediately rather than waiting on the
    // round trip, and put it back if the save doesn't actually go through.
    setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, week_number: weekKey } : ev)));
    const result = await updateEvent({ organizationId, eventId, weekNumber: weekKey });
    if ('error' in result) {
      setError(result.error);
      setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, week_number: previousWeek } : ev)));
      return;
    }
    if ('conflicts' in result) {
      // A week-number-only patch never actually triggers this, but handle
      // it defensively in case that ever changes.
      setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, week_number: previousWeek } : ev)));
    }
  }

  async function swapTeams(a: EventRow, b: EventRow) {
    setError(null);
    // Optimistic: swap immediately rather than waiting on two round trips,
    // and put both back if either half is declined or fails.
    setEvents((prev) =>
      prev.map((ev) => {
        if (ev.id === a.id) return { ...ev, home_team_id: b.home_team_id, away_team_id: b.away_team_id };
        if (ev.id === b.id) return { ...ev, home_team_id: a.home_team_id, away_team_id: a.away_team_id };
        return ev;
      })
    );
    function revert() {
      setEvents((prev) =>
        prev.map((ev) => {
          if (ev.id === a.id) return { ...ev, home_team_id: a.home_team_id, away_team_id: a.away_team_id };
          if (ev.id === b.id) return { ...ev, home_team_id: b.home_team_id, away_team_id: b.away_team_id };
          return ev;
        })
      );
    }

    const resA = await updateWithConflictConfirm({
      organizationId,
      eventId: a.id,
      homeTeamId: b.home_team_id,
      awayTeamId: b.away_team_id,
    });
    if ('error' in resA) {
      setError(resA.error);
      revert();
      return;
    }
    if ('cancelled' in resA) {
      revert();
      return;
    }

    const resB = await updateWithConflictConfirm({
      organizationId,
      eventId: b.id,
      homeTeamId: a.home_team_id,
      awayTeamId: a.away_team_id,
    });
    if ('error' in resB || 'cancelled' in resB) {
      // b's half didn't go through (declined or failed) — put a back the
      // way it was server-side too, since resA already committed there.
      await updateEvent({
        organizationId,
        eventId: a.id,
        homeTeamId: a.home_team_id,
        awayTeamId: a.away_team_id,
        allowConflicts: true,
      });
      if ('error' in resB) setError(resB.error);
      revert();
    }
  }

  function handleDragStart(e: React.DragEvent, eventId: string) {
    setDraggedId(eventId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', eventId);
  }

  function handleDragEnd() {
    setDraggedId(null);
    setDragOverWeekKey(undefined);
    setDragOverRowId(null);
  }

  function handleDropOnGame(e: React.DragEvent, target: EventRow) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverWeekKey(undefined);
    setDragOverRowId(null);
    const sourceId = draggedId;
    setDraggedId(null);
    if (!sourceId || sourceId === target.id) return;
    const source = events.find((ev) => ev.id === sourceId);
    if (!source || source.status === 'published') return;

    if (source.type === 'game' && target.type === 'game') {
      if (source.division_id !== target.division_id) {
        setError("Can't swap teams between games in different divisions.");
        return;
      }
      swapTeams(source, target);
      return;
    }
    // Dropped on a non-game (or mixed-type) row — fall back to a week
    // move using whatever week that row is under.
    moveToWeek(sourceId, target.week_number ?? null);
  }

  function handleDropOnWeek(e: React.DragEvent, weekKey: number | null) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverWeekKey(undefined);
    setDragOverRowId(null);
    const sourceId = draggedId;
    setDraggedId(null);
    if (!sourceId) return;
    const source = events.find((ev) => ev.id === sourceId);
    if (!source || source.status === 'published') return;
    if ((source.week_number ?? null) === weekKey) return;
    moveToWeek(sourceId, weekKey);
  }

  function clearSlotDraft(slotKey: string) {
    setSlotDraftHome((prev) => {
      const next = { ...prev };
      delete next[slotKey];
      return next;
    });
    setSlotOpponentChoice((prev) => {
      const next = { ...prev };
      delete next[slotKey];
      return next;
    });
  }

  // Drag an existing draft game onto an open slot: its date/time and
  // field now match the slot (and its week label follows along), same
  // conflict-check flow as any other edit.
  async function moveEventToSlot(eventId: string, slot: OpenSlot) {
    setError(null);
    const previous = events.find((ev) => ev.id === eventId);
    if (!previous) return;
    const prevSnapshot = { start_time: previous.start_time, location: previous.location, week_number: previous.week_number };
    setEvents((prev) =>
      prev.map((ev) =>
        ev.id === eventId ? { ...ev, start_time: slot.startTimeIso, location: slot.field, week_number: slot.weekNumber } : ev
      )
    );
    const result = await updateWithConflictConfirm({
      organizationId,
      eventId,
      startTime: slot.startTimeIso,
      location: slot.field,
      weekNumber: slot.weekNumber,
    });
    if ('error' in result) {
      setError(result.error);
      setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, ...prevSnapshot } : ev)));
      return;
    }
    if ('cancelled' in result) {
      setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, ...prevSnapshot } : ev)));
    }
  }

  async function createWithConflictConfirm(
    input: Parameters<typeof createEvent>[0]
  ): Promise<{ id: string } | { error: string } | { cancelled: true }> {
    const result = await createEvent(input);
    if ('conflicts' in result) {
      if (confirm(describeConflicts(result.conflicts))) {
        return createWithConflictConfirm({ ...input, allowConflicts: true });
      }
      return { cancelled: true };
    }
    return result;
  }

  // The second half of filling an open slot with a team dragged in: once
  // an opponent is picked from the dropdown, actually create the game.
  async function handleCreateGameForSlot(slot: OpenSlot, homeTeamId: string, awayTeamId: string | undefined) {
    if (!awayTeamId) return;
    setError(null);
    setCreatingSlotKey(slot.key);
    try {
      const homeName = teams.find((t) => t.id === homeTeamId)?.name ?? 'Home';
      const awayName = teams.find((t) => t.id === awayTeamId)?.name ?? 'Away';
      const result = await createWithConflictConfirm({
        organizationId,
        seasonId: selectedSeasonId || undefined,
        divisionId: selectedDivisionId || undefined,
        type: 'game',
        title: `${homeName} vs ${awayName}`,
        location: slot.field,
        startTime: slot.startTimeIso,
        homeTeamId,
        awayTeamId,
        weekNumber: slot.weekNumber,
      });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      if ('cancelled' in result) return;
      setEvents((prev) => [
        ...prev,
        {
          id: result.id,
          type: 'game',
          title: `${homeName} vs ${awayName}`,
          location: slot.field,
          start_time: slot.startTimeIso,
          end_time: null,
          status: 'draft',
          season_id: selectedSeasonId || null,
          division_id: selectedDivisionId || null,
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          week_number: slot.weekNumber,
        },
      ]);
      clearSlotDraft(slot.key);
    } finally {
      setCreatingSlotKey(null);
    }
  }

  // A drop on an open slot means one of two things: dragging in a team
  // that still needs a game (stages it as the proposed home team, see
  // renderOpenSlotRow) or dragging in an existing draft game (moves it
  // straight into the slot).
  function handleDropOnSlot(e: React.DragEvent, slot: OpenSlot) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverWeekKey(undefined);
    setDragOverRowId(null);

    if (draggedTeamId) {
      const teamId = draggedTeamId;
      setDraggedTeamId(null);
      setSlotDraftHome((prev) => ({ ...prev, [slot.key]: teamId }));
      return;
    }

    const sourceId = draggedId;
    setDraggedId(null);
    if (!sourceId) return;
    const source = events.find((ev) => ev.id === sourceId);
    if (!source || source.status === 'published') return;
    moveEventToSlot(sourceId, slot);
  }

  function renderEventRow(ev: EventRow) {
    if (editingId === ev.id) {
      return (
        <div key={ev.id} className="data-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="form-input" placeholder="Title" />
          <input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className="form-input" placeholder="Location" />
          <input
            type="datetime-local"
            value={editStartTime}
            onChange={(e) => setEditStartTime(e.target.value)}
            className="form-input"
          />
          {ev.type === 'game' && (
            <>
              <select value={editHomeTeamId} onChange={(e) => setEditHomeTeamId(e.target.value)} className="form-input">
                <option value="">Home team…</option>
                {renderTeamOptions(ev.division_id)}
              </select>
              <select value={editAwayTeamId} onChange={(e) => setEditAwayTeamId(e.target.value)} className="form-input">
                <option value="">Away team…</option>
                {renderTeamOptions(ev.division_id)}
              </select>
            </>
          )}
          <input
            type="number"
            value={editWeekNumber}
            onChange={(e) => setEditWeekNumber(e.target.value)}
            className="form-input"
            placeholder="Week number (optional)"
            style={{ maxWidth: 200 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handleSaveEdit(ev.id)} disabled={savingEdit} className="btn-primary">
              {savingEdit ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancelEdit} className="btn-small">
              Cancel
            </button>
          </div>
        </div>
      );
    }

    const draggableRow = ev.status !== 'published';
    const isDragSource = draggedId === ev.id;
    const isDropTarget = Boolean(draggedId) && draggedId !== ev.id && dragOverRowId === ev.id;
    return (
      <div
        key={ev.id}
        className="data-row"
        draggable={draggableRow}
        onDragStart={draggableRow ? (e) => handleDragStart(e, ev.id) : undefined}
        onDragEnd={draggableRow ? handleDragEnd : undefined}
        onDragOver={(e) => {
          if (draggedId && draggedId !== ev.id) {
            e.preventDefault();
            if (dragOverRowId !== ev.id) setDragOverRowId(ev.id);
          }
        }}
        onDragLeave={() => setDragOverRowId((id) => (id === ev.id ? null : id))}
        onDrop={(e) => handleDropOnGame(e, ev)}
        style={{
          opacity: isDragSource ? 0.4 : 1,
          cursor: draggableRow ? 'grab' : undefined,
          background: isDropTarget ? 'var(--gray-light)' : undefined,
          outline: isDropTarget ? '2px solid var(--blue)' : isDragSource ? '2px dashed var(--blue)' : undefined,
          outlineOffset: -2,
          borderRadius: isDropTarget || isDragSource ? 8 : undefined,
          transition: 'background 0.08s ease, opacity 0.08s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <input
            type="checkbox"
            checked={selectedIds.has(ev.id)}
            onChange={() => toggleSelected(ev.id)}
            style={{ marginTop: 4 }}
          />
          <div>
            <div className="data-row-name">
              {ev.title}
              {ev.type === 'game' && (ev.home_team_id || ev.away_team_id) && (
                <span> — {teamName(ev.home_team_id)} vs {teamName(ev.away_team_id)}</span>
              )}
            </div>
            <div className="data-row-meta">
              {new Date(ev.start_time).toLocaleString()} {ev.location && `· ${ev.location}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`status-badge ${ev.status === 'published' ? 'confirmed' : ev.status === 'canceled' ? 'canceled' : 'pending'}`}>
            {ev.status}
          </span>
          {ev.status !== 'published' && (
            <button onClick={() => handleToggleStatus(ev.id, 'published')} className="btn-small">
              Publish
            </button>
          )}
          {ev.status === 'published' && (
            <button onClick={() => handleToggleStatus(ev.id, 'draft')} className="btn-small">
              Unpublish
            </button>
          )}
          <button onClick={() => startEdit(ev)} className="btn-small">
            Edit
          </button>
          <button onClick={() => handleDelete(ev.id)} className="btn-small">
            Delete
          </button>
        </div>
      </div>
    );
  }

  function renderOpenSlotRow(slot: OpenSlot) {
    const homeTeamId = slotDraftHome[slot.key];
    const homeTeam = homeTeamId ? teams.find((t) => t.id === homeTeamId) : null;
    const isDropTarget = (Boolean(draggedId) || Boolean(draggedTeamId)) && dragOverRowId === slot.key;

    return (
      <div
        key={slot.key}
        className="data-row"
        onDragOver={(e) => {
          if (draggedId || draggedTeamId) {
            e.preventDefault();
            if (dragOverRowId !== slot.key) setDragOverRowId(slot.key);
          }
        }}
        onDragLeave={() => setDragOverRowId((id) => (id === slot.key ? null : id))}
        onDrop={(e) => handleDropOnSlot(e, slot)}
        style={{
          border: '1px dashed var(--border)',
          background: isDropTarget ? 'var(--gray-light)' : undefined,
          outline: isDropTarget ? '2px solid var(--blue)' : undefined,
          outlineOffset: -2,
          borderRadius: 8,
        }}
      >
        <div>
          <div className="data-row-name" style={{ color: 'var(--gray)' }}>
            {homeTeam ? (
              <>
                {homeTeam.name} vs{' '}
                <select
                  value={slotOpponentChoice[slot.key] ?? ''}
                  onChange={(e) => setSlotOpponentChoice((prev) => ({ ...prev, [slot.key]: e.target.value }))}
                  className="form-input"
                  style={{ display: 'inline-block', width: 'auto', marginBottom: 0 }}
                >
                  <option value="">Pick opponent…</option>
                  {shortTeams
                    .filter((t) => t.teamId !== homeTeamId)
                    .map((t) => (
                      <option key={t.teamId} value={t.teamId}>
                        {t.teamName} (needs {t.needed} more)
                      </option>
                    ))}
                </select>
              </>
            ) : (
              'Open slot — drag a team or a draft game here'
            )}
          </div>
          <div className="data-row-meta">
            {slot.date.toLocaleDateString()} {slot.time} · {slot.field}
          </div>
        </div>
        {homeTeam && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => handleCreateGameForSlot(slot, homeTeamId, slotOpponentChoice[slot.key])}
              disabled={!slotOpponentChoice[slot.key] || creatingSlotKey === slot.key}
              className="btn-primary"
            >
              {creatingSlotKey === slot.key ? 'Creating…' : 'Create game'}
            </button>
            <button onClick={() => clearSlotDraft(slot.key)} className="btn-small">
              Clear
            </button>
          </div>
        )}
      </div>
    );
  }

  const allVisibleSelected =
    filteredEvents.length > 0 && filteredEvents.every((ev) => selectedIds.has(ev.id));

  return (
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      {seasons.length === 0 ? (
        <p style={{ color: 'var(--gray)' }}>No seasons exist yet — create one first.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            <select
              value={selectedSeasonId}
              onChange={(e) => handleSeasonChange(e.target.value)}
              className="form-input"
              style={{ marginBottom: 0, width: 'auto' }}
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={selectedDivisionId}
              onChange={(e) => setSelectedDivisionId(e.target.value)}
              className="form-input"
              style={{ marginBottom: 0, width: 'auto' }}
            >
              <option value="">All divisions</option>
              {divisionsForSeason.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button onClick={handlePublishAll} className="btn-small">
              Publish all drafts
            </button>
            <button onClick={handleExportGameChanger} className="btn-small">
              Export for GameChanger
            </button>
            <button onClick={handleExportSportConnect} className="btn-small">
              Export for SportConnect
            </button>
            <button onClick={() => setShowBalanceReport((s) => !s)} className="btn-small" style={{ marginLeft: 'auto' }}>
              {showBalanceReport ? 'Hide balance report' : 'Balance report'}
            </button>
            <button
              onClick={() => setShowOpenSlots((s) => !s)}
              className="btn-small"
              title={!selectedDivisionId ? 'Pick a single division above to see its open slots' : undefined}
            >
              {showOpenSlots ? 'Hide open slots' : 'Open slots'}
            </button>
            <button onClick={() => setShowForm((s) => !s)} className="btn-small">
              {showForm ? 'Cancel' : '+ Add event'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -12, marginBottom: 20 }}>
            Both exports download a CSV of the games currently shown above (filtered by the season/division
            picked here), formatted for that platform&apos;s bulk schedule import. Team names must already match
            the roster already set up on that platform exactly.
          </p>

          {showBalanceReport && (
            <div className="form-card" style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -4, marginBottom: 16 }}>
                Home/away and matchup counts for the games currently shown above (draft and published, excluding
                canceled). Some drift is normal — an odd number of teams leaves someone with an extra home or away
                game, and a manually-added bonus game adds one extra matchup on purpose — so treat this as
                something to eyeball, not a hard rule.
              </p>
              {divisionBalances.length === 0 && <p style={{ color: 'var(--gray)' }}>No games to check yet.</p>}
              {divisionBalances.map((db) => {
                const homeAwayFlags = db.rows.filter((r) => Math.abs(r.home - r.away) >= 2);
                const matchupFlags = db.matchups.filter((m) => Math.abs(m.count - db.matchupMedian) >= 1);
                const isClean = homeAwayFlags.length === 0 && matchupFlags.length === 0;
                return (
                  <div key={db.divisionId} style={{ marginBottom: 28 }}>
                    <h3 style={{ fontSize: 14, marginBottom: 4 }}>{db.divisionName}</h3>
                    <p style={{ fontSize: 12, color: isClean ? 'var(--gray)' : '#B23A2E', marginBottom: 10 }}>
                      {isClean
                        ? 'Looks balanced — every team is within 1 game of even home/away, and matchup counts are even.'
                        : [
                            homeAwayFlags.length > 0
                              ? `${homeAwayFlags.length} team(s) with a home/away gap of 2 or more.`
                              : null,
                            matchupFlags.length > 0
                              ? `${matchupFlags.length} matchup(s) off this division's typical count (${db.matchupMedian}).`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                    </p>

                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '6px 8px' }}>Team</th>
                          <th style={{ padding: '6px 8px' }}>Home</th>
                          <th style={{ padding: '6px 8px' }}>Away</th>
                          <th style={{ padding: '6px 8px' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {db.rows.map((r) => {
                          const flagged = Math.abs(r.home - r.away) >= 2;
                          return (
                            <tr
                              key={r.teamId}
                              style={{ borderBottom: '1px solid var(--border)', background: flagged ? '#FBEAE8' : undefined }}
                            >
                              <td style={{ padding: '6px 8px' }}>{r.teamName}</td>
                              <td style={{ padding: '6px 8px', color: flagged ? '#B23A2E' : undefined }}>{r.home}</td>
                              <td style={{ padding: '6px 8px', color: flagged ? '#B23A2E' : undefined }}>{r.away}</td>
                              <td style={{ padding: '6px 8px' }}>{r.home + r.away}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {db.matchups.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                            <th style={{ padding: '6px 8px' }}>Matchup</th>
                            <th style={{ padding: '6px 8px' }}>Games</th>
                          </tr>
                        </thead>
                        <tbody>
                          {db.matchups.map((m) => {
                            const flagged = Math.abs(m.count - db.matchupMedian) >= 1;
                            return (
                              <tr
                                key={`${m.teamAId}-${m.teamBId}`}
                                style={{ borderBottom: '1px solid var(--border)', background: flagged ? '#FBEAE8' : undefined }}
                              >
                                <td style={{ padding: '6px 8px' }}>
                                  {m.teamAName} vs {m.teamBName}
                                </td>
                                <td style={{ padding: '6px 8px', color: flagged ? '#B23A2E' : undefined }}>{m.count}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {showOpenSlots && (
            <div className="form-card" style={{ marginBottom: 24 }}>
              {!selectedDivisionId ? (
                <p style={{ color: 'var(--gray)' }}>Pick a single division above (not &quot;All divisions&quot;) to see its open slots.</p>
              ) : !selectedDivisionSettings ? (
                <p style={{ color: 'var(--gray)' }}>
                  This division hasn&apos;t generated a schedule yet, so there&apos;s no saved field/day/time
                  configuration to show open slots for.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -4, marginBottom: 12 }}>
                    Drag a team below onto an open slot in the list to start a game there, then pick its opponent
                    to create it. Drag an existing draft game onto an open slot to move it there instead — its
                    date, time, and field all update to match.
                  </p>
                  {shortTeams.length === 0 ? (
                    <p style={{ color: 'var(--gray)', fontSize: 13 }}>
                      Every team in this division has already reached its target game count.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {shortTeams.map((t) => (
                        <div
                          key={t.teamId}
                          draggable
                          onDragStart={(e) => {
                            setDraggedTeamId(t.teamId);
                            e.dataTransfer.effectAllowed = 'copy';
                            e.dataTransfer.setData('text/plain', t.teamId);
                          }}
                          onDragEnd={() => setDraggedTeamId(null)}
                          className="status-badge pending"
                          style={{ cursor: 'grab', padding: '6px 12px' }}
                        >
                          {t.teamName} · needs {t.needed} more
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {showForm && (
            <form onSubmit={handleCreate} className="form-card" style={{ marginBottom: 24 }}>
              {type === 'game' && (
                <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -4, marginBottom: 12 }}>
                  Use this for a one-off game the season generator wouldn&apos;t create on its own — for example,
                  an extra 3rd game for two specific teams in one week to help a division catch up before the
                  season&apos;s end date if the standard weekly pattern couldn&apos;t fit every team&apos;s full game
                  count.
                </p>
              )}
              <select value={type} onChange={(e) => setType(e.target.value as any)} className="form-input">
                {EVENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="form-input" required />
              <input placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} className="form-input" />
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="form-input"
                required
              />

              {type === 'game' && (
                <>
                  <select value={homeTeamId} onChange={(e) => setHomeTeamId(e.target.value)} className="form-input">
                    <option value="">Home team…</option>
                    {renderTeamOptions(selectedDivisionId || null)}
                  </select>
                  <select value={awayTeamId} onChange={(e) => setAwayTeamId(e.target.value)} className="form-input">
                    <option value="">Away team…</option>
                    {renderTeamOptions(selectedDivisionId || null)}
                  </select>
                  <input
                    type="number"
                    value={weekNumber}
                    onChange={(e) => setWeekNumber(e.target.value)}
                    className="form-input"
                    placeholder="Week number (optional)"
                    style={{ maxWidth: 220 }}
                  />
                  <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -8, marginBottom: 12 }}>
                    Groups this game with that week&apos;s others on this page — match whatever week number is already
                    showing for the week you want it under, or leave blank to file it as Unscheduled.
                  </p>
                </>
              )}

              <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
                {submitting ? 'Adding…' : 'Add event'}
              </button>
            </form>
          )}

          {filteredEvents.length === 0 && openSlots.length === 0 && <p style={{ color: 'var(--gray)' }}>No events yet.</p>}
          {(filteredEvents.length > 0 || openSlots.length > 0) && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--gray)' }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
                  Select all shown
                </label>
                {selectedIds.size > 0 && (
                  <button onClick={handleBulkDelete} disabled={bulkDeleting} className="btn-small">
                    {bulkDeleting ? 'Deleting…' : `Delete selected (${selectedIds.size})`}
                  </button>
                )}
              </div>

              <p style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 12 }}>
                Drag a draft game or event onto a different week below to move it there, or drop one draft game
                directly onto another to swap which teams are assigned to each. Published games aren&apos;t
                draggable — unpublish first, or use Edit.
              </p>

              {sortedWeekKeys.map((weekKey) => {
                const isWeekDropTarget = Boolean(draggedId) && dragOverWeekKey === weekKey;
                return (
                <div
                  key={weekKey ?? 'unscheduled'}
                  style={{
                    marginBottom: 20,
                    outline: isWeekDropTarget ? '2px dashed var(--blue)' : undefined,
                    outlineOffset: 4,
                    background: isWeekDropTarget ? 'rgba(37, 99, 235, 0.06)' : undefined,
                    borderRadius: 8,
                    transition: 'background 0.08s ease',
                  }}
                  onDragOver={(e) => {
                    if (draggedId) {
                      e.preventDefault();
                      if (dragOverWeekKey !== weekKey) setDragOverWeekKey(weekKey);
                    }
                  }}
                  onDragLeave={() => setDragOverWeekKey((k) => (k === weekKey ? undefined : k))}
                  onDrop={(e) => handleDropOnWeek(e, weekKey)}
                >
                  <h3 style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 8 }}>
                    {weekKey === null ? 'Unscheduled / manually added' : `Week ${weekKey}`}
                  </h3>
                  <div className="data-table-card">
                    {(weekGroups.get(weekKey) ?? []).map((ev) => renderEventRow(ev))}
                    {weekKey !== null && (openSlotsByWeek.get(weekKey) ?? []).map((slot) => renderOpenSlotRow(slot))}
                  </div>
                </div>
                );
              })}
            </>
          )}
        </>
      )}
    </div>
  );
}
