'use server';

// lib/actions/auto-schedule.ts
//
// Generates a full SEASON-LONG schedule, not a single round-robin pass.
// A rec league season needs teams to play repeatedly across many weeks,
// so this builds one fair round-robin cycle (every team plays every team
// once) and then REPEATS that cycle across every available game date —
// stopping once every team has reached the target number of games
// (gamesPerTeam), or once the season's end date is reached, whichever
// comes first. The end date is a hard backstop, not the primary driver of
// how long the season runs — gamesPerTeam is.
//
// Placement is a single continuous fill across the whole date range —
// see Step 4 — not a "round" system where a fixed batch of matchups has
// to fully land on specific dates before the next batch can start. Every
// configured game date (weekday and weekend alike) draws from the same
// pending queue of matchups in fairness order, so a date with more open
// slots naturally carries more of the load and a blacked-out or fully-
// booked date just means fewer chances that day — never a lost matchup.
//
// Each day of the week carries its own list of (time, field) slots,
// rather than one flat set of times/fields applied to every selected
// day — a weekday might only offer a single 5pm slot, while Saturday
// could offer many across several fields, because fields are often
// shared with other divisions and only free at specific times.
//
// Before placing a game into any (date, time, field) slot, this also
// checks the organization's EXISTING events — any season, any division —
// for that same field and exact time, and skips slots that are already
// taken. That's what keeps two divisions sharing the same physical field
// from getting double-booked into the same game.
//
// Every game created in one generation run also gets a week_number,
// which IS a real calendar week (1-based, counted from the season's own
// start date using weekStartDay) — see Step 3b.
//
// If the date range runs out before every team hits gamesPerTeam, the
// leftover matchups aren't just reported as a shortfall — Step 4b finds
// a few real open slots for each one (a week where neither team already
// has a game, on a date/time/field that's otherwise free) so the admin
// can place them by hand from the Season Builder results.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';
import { getOrgTeamCoaches, buildCoachBusyIntervals, intervalsOverlap, type BusyInterval } from '@/lib/scheduling-conflicts';

interface DaySlotInput {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  time: string; // "18:00", "19:30", etc — 24hr format
  field: string; // location name, e.g. "Field 1"
}

interface GenerateScheduleInput {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  daySlots: DaySlotInput[];
  gamesPerTeam: number;
  gameDurationMinutes: number; // used to stamp events.end_time on every created game
  startDate: string; // "2026-09-01"
  endDate: string; // "2026-11-15" — a hard cap, not a target
  // IANA zone (e.g. "America/Los_Angeles"), read from the admin's own
  // browser via Intl.DateTimeFormat().resolvedOptions().timeZone. This
  // runs as a server action, and the server's own clock is UTC (Vercel) —
  // without this, "5pm" would get stamped as 5pm UTC instead of 5pm in
  // the league's actual timezone. Falls back to UTC if somehow missing.
  timeZone?: string;
  // Optional cap on how many games a single team can play within one
  // calendar week (migration 0024). Undefined/null means no cap — a
  // matchup is only ever deferred to a later date because of a taken
  // slot, blackout, field reservation, or coach conflict, same as before
  // this feature existed.
  maxGamesPerWeek?: number;
  // Which weekday (0=Sunday..6=Saturday) starts the calendar week used to
  // enforce maxGamesPerWeek. Defaults to 0 (Sunday) when omitted. Ignored
  // entirely when maxGamesPerWeek isn't set.
  weekStartDay?: number;
  // Optional weekday (0=Sunday..6=Saturday, migration 0026) to fill FIRST
  // within every calendar week, before any other configured day — see
  // Step 1b. Undefined/null means no priority day: dates fill in plain
  // chronological order, same as before this feature existed.
  priorityDayOfWeek?: number;
}

/**
 * Standard "circle method" round-robin: fixes team[0], rotates the rest
 * each round. Returns one round-robin CYCLE — every team plays every
 * other team exactly once across the returned rounds. If teamIds.length
 * is odd, a null "bye" is padded in — any round pairing a team against
 * null is simply skipped when assigning games.
 */
function buildRoundRobinCycle(teamIds: string[]): (string | null)[][][] {
  const teams: (string | null)[] = [...teamIds];
  if (teams.length % 2 !== 0) teams.push(null); // bye

  const n = teams.length;
  const rounds: (string | null)[][][] = [];

  const rotating = teams.slice(1);
  const fixed = teams[0];

  for (let round = 0; round < n - 1; round++) {
    const roundPairs: (string | null)[][] = [];
    const current = [fixed, ...rotating];
    for (let i = 0; i < n / 2; i++) {
      roundPairs.push([current[i], current[n - 1 - i]]);
    }
    rounds.push(roundPairs);
    // rotate: move last element of `rotating` to the front
    rotating.unshift(rotating.pop()!);
  }

  return rounds;
}

// Converts a calendar date + wall-clock "HH:MM" into the correct UTC
// instant for a given IANA timezone, handling DST correctly (a season
// can easily span a fall-back/spring-forward transition). Works by
// guessing the UTC instant naively, asking Intl what wall-clock time
// that guess renders as in the target zone, then correcting by the
// difference — the standard round-trip technique for this without a
// timezone library.
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

interface BlackoutRow {
  kind: 'date' | 'weekly' | 'daily';
  field_name: string | null;
  blackout_date: string | null;
  end_date: string | null;
  days_of_week: number[] | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Local (not UTC-shifted) calendar-date string, used as a map key
// wherever a Date needs to be compared/grouped by its own day rather
// than by its UTC instant.
function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// Groups a date into a "week" for maxGamesPerWeek purposes, given which
// weekday starts that week (0=Sunday..6=Saturday). Returns the ISO date
// (YYYY-MM-DD, in the schedule's own local calendar — not UTC-shifted)
// of that week's first day, so two dates in the same week always produce
// an identical, directly comparable key regardless of which day within
// the week they fall on.
function getWeekKey(date: Date, weekStartDay: number): string {
  const diff = (date.getDay() - weekStartDay + 7) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(weekStart.getDate() - diff);
  return `${weekStart.getFullYear()}-${pad2(weekStart.getMonth() + 1)}-${pad2(weekStart.getDate())}`;
}

// Whether a candidate (date, time, field) slot falls inside any of the
// season's blackouts — see migration 0017 for what each `kind` means. A
// blackout with no start/end time blocks the WHOLE occurrence (the whole
// day, for 'date'; every instance of that weekday, for 'weekly'; every
// day, for 'daily'). One with a time range only blocks a slot whose start
// time falls inside [start, end) that day, converted through the same
// timezone logic as the slot itself so a blackout defined as "6-9pm"
// means 6-9pm locally, not UTC.
function isBlackedOut(date: Date, time: string, field: string, blackouts: BlackoutRow[], timeZone: string): boolean {
  if (blackouts.length === 0) return false;

  const dateStr = dateKey(date);
  const slotMs = new Date(zonedDateTimeToIso(date, time, timeZone)).getTime();

  for (const b of blackouts) {
    if (b.field_name && b.field_name.toLowerCase() !== field.toLowerCase()) continue;

    let dayMatches = false;
    if (b.kind === 'date' && b.end_date) {
      // A ranged date blackout: every day from blackout_date through
      // end_date (inclusive), optionally restricted to specific weekdays
      // within that range (e.g. "weekdays only" for a lack-of-sunlight
      // stretch of the season) — see migration 0025.
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

    if (!b.start_time || !b.end_time) return true; // whole day/occurrence blocked

    const startMs = new Date(zonedDateTimeToIso(date, b.start_time, timeZone)).getTime();
    const endMs = new Date(zonedDateTimeToIso(date, b.end_time, timeZone)).getTime();
    if (slotMs >= startMs && slotMs < endMs) return true;
  }

  return false;
}

// A matchup that's still needed (neither team has reached gamesPerTeam)
// but never found an open, eligible date/time/field within the season's
// date range — see Step 4b. candidateSlots is a short list of real open
// slots the admin could place it into by hand; empty means nothing open
// was found at all (every remaining slot is booked, blacked out, or
// would double-book a coach for both teams' whole remaining season).
interface UnplacedMatchup {
  homeTeamId: string;
  awayTeamId: string;
  candidateSlots: { startTime: string; field: string; weekNumber: number }[];
}

type GenerateScheduleResult =
  | {
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
      // Set only when the best-effort "remember these inputs" write in
      // Step 6 fails — the schedule itself already succeeded by then, so
      // this doesn't turn generation into a failure, but a silently
      // swallowed error here is exactly what made settings appear to
      // "randomly stop saving": worth surfacing so it's diagnosable
      // instead of invisible.
      settingsSaveWarning?: string;
    }
  | { error: string };

export async function generateSeasonSchedule(input: GenerateScheduleInput): Promise<GenerateScheduleResult> {
  try {
    const authorized = await requireOrgPermission(input.organizationId, 'manage_schedule');
    if (!authorized) {
      return { error: 'You do not have permission to generate a schedule.' };
    }

    if (input.daySlots.length === 0) {
      return { error: 'Add at least one time/field slot to a game day.' };
    }
    if (!input.startDate || !input.endDate) {
      return { error: 'Set both a season start and end date.' };
    }
    if (!Number.isFinite(input.gamesPerTeam) || input.gamesPerTeam < 1) {
      return { error: 'Set how many games each team should play (at least 1).' };
    }
    if (!Number.isFinite(input.gameDurationMinutes) || input.gameDurationMinutes < 1) {
      return { error: 'Set a game duration of at least 1 minute.' };
    }
    if (
      input.maxGamesPerWeek !== undefined &&
      input.maxGamesPerWeek !== null &&
      (!Number.isFinite(input.maxGamesPerWeek) || input.maxGamesPerWeek < 1)
    ) {
      return { error: 'Max games per week must be at least 1 (leave it blank for no cap).' };
    }
    if (
      input.weekStartDay !== undefined &&
      (!Number.isInteger(input.weekStartDay) || input.weekStartDay < 0 || input.weekStartDay > 6)
    ) {
      return { error: 'Week start day must be between 0 (Sunday) and 6 (Saturday).' };
    }
    if (
      input.priorityDayOfWeek !== undefined &&
      input.priorityDayOfWeek !== null &&
      (!Number.isInteger(input.priorityDayOfWeek) || input.priorityDayOfWeek < 0 || input.priorityDayOfWeek > 6)
    ) {
      return { error: 'Priority day must be between 0 (Sunday) and 6 (Saturday).' };
    }

    const timeZone = input.timeZone || 'UTC';
    const weekStartDay = input.weekStartDay ?? 0;
    const maxGamesPerWeek =
      input.maxGamesPerWeek !== undefined && input.maxGamesPerWeek !== null ? input.maxGamesPerWeek : null;
    const priorityDayOfWeek =
      input.priorityDayOfWeek !== undefined && input.priorityDayOfWeek !== null ? input.priorityDayOfWeek : null;

    const admin = createAdminClient();

    const { data: teams } = await admin
      .from('teams')
      .select('id')
      .eq('division_id', input.divisionId);

    const teamIds = (teams ?? []).map((t) => t.id);
    if (teamIds.length < 2) {
      return { error: 'Need at least 2 teams in this division to generate a schedule.' };
    }

    // ---- group configured slots by day of week, sorted by time for
    // deterministic ordering within a date ----
    const slotsByDay = new Map<number, DaySlotInput[]>();
    for (const slot of input.daySlots) {
      const list = slotsByDay.get(slot.dayOfWeek) ?? [];
      list.push(slot);
      slotsByDay.set(slot.dayOfWeek, list);
    }
    for (const list of slotsByDay.values()) {
      list.sort((a, b) => a.time.localeCompare(b.time));
    }


    // ---- Step 1: every actual calendar date in range that has at least
    // one configured slot for its day of week (endDate is a hard cap on
    // how far this ever looks, not a target) ----
    const gameDates: Date[] = [];
    const cursor = new Date(input.startDate + 'T00:00:00');
    const end = new Date(input.endDate + 'T00:00:00');
    while (cursor <= end) {
      if (slotsByDay.has(cursor.getDay())) {
        gameDates.push(new Date(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    if (gameDates.length === 0) {
      return { error: 'No game dates fall within that range on the configured days.' };
    }

    // ---- Step 1b: if a priority day is set, move that day's date to the
    // front of each calendar week's block of dates. Weeks themselves stay
    // in chronological order — this only reorders WITHIN a week — so Step
    // 3b's week-number assignment (which just watches the week key change
    // as it walks gameDates in order) and every date-range/target-reached
    // check downstream keep working unmodified. The actual effect is in
    // Step 4: its dateLoop tries gameDates in array order, so the
    // priority day's slots get first crack at that week's fairness queue
    // before any other day in the same week is tried — a team's weekly
    // allotment lands there whenever there's enough slot capacity that
    // day, without changing which dates are available at all. ----
    if (priorityDayOfWeek !== null) {
      const weeks: Date[][] = [];
      let currentWeekKey: string | null = null;
      for (const date of gameDates) {
        const wk = getWeekKey(date, weekStartDay);
        if (wk !== currentWeekKey) {
          weeks.push([]);
          currentWeekKey = wk;
        }
        weeks[weeks.length - 1].push(date);
      }
      gameDates.length = 0;
      for (const week of weeks) {
        const priority = week.filter((d) => d.getDay() === priorityDayOfWeek);
        const rest = week.filter((d) => d.getDay() !== priorityDayOfWeek);
        gameDates.push(...priority, ...rest);
      }
    }

    // ---- Step 2: existing events across the WHOLE organization (any
    // season, any division) in this date range, so a field shared with
    // another division doesn't get double-booked. This division's own
    // DRAFT games are excluded from the conflict set — regenerating
    // replaces them (see Step 5), so they're not real commitments to
    // avoid double-booking against; its own PUBLISHED games (and every
    // other division's events, draft or published) still block. ----
    const { data: existingEvents } = await admin
      .from('events')
      .select('id, title, location, start_time, end_time, division_id, status, home_team_id, away_team_id')
      .eq('organization_id', input.organizationId)
      .neq('status', 'canceled')
      .not('location', 'is', null)
      .gte('start_time', new Date(input.startDate + 'T00:00:00').toISOString())
      .lte('start_time', new Date(input.endDate + 'T23:59:59').toISOString());

    const relevantExistingEvents = (existingEvents ?? []).filter(
      (e) => !(e.division_id === input.divisionId && e.status === 'draft')
    );
    const occupied = new Set(relevantExistingEvents.map((e) => `${e.location}|${e.start_time}`));

    // ---- Step 2d: coach conflicts (0023_team_staff.sql) — a coach can
    // staff more than one team, including teams in OTHER divisions, so
    // this has to know about every team in the org, not just this
    // division's. Excludes this division's own draft games from the
    // "existing commitments" set for the same reason Step 2 does: they're
    // about to be replaced, not real conflicts to avoid. Extended with
    // this run's own placements as they're made below, so two games
    // created in the SAME generation call (e.g. a coach on two teams
    // within this division) can't double-book each other either. ----
    const teamCoaches = await getOrgTeamCoaches(admin, input.organizationId);
    const busyByPerson = buildCoachBusyIntervals(
      relevantExistingEvents as {
        id: string;
        title: string;
        start_time: string;
        end_time: string | null;
        home_team_id: string | null;
        away_team_id: string | null;
      }[],
      teamCoaches,
      input.gameDurationMinutes * 60000
    );

    function coachConflictAt(homeId: string, awayId: string, startMs: number, endMs: number): boolean {
      const coachIds = new Set<string>([...(teamCoaches.get(homeId) ?? []), ...(teamCoaches.get(awayId) ?? [])]);
      for (const personId of coachIds) {
        for (const busy of busyByPerson.get(personId) ?? []) {
          if (intervalsOverlap(startMs, endMs, busy.start, busy.end)) return true;
        }
      }
      return false;
    }

    function recordCoachBusy(homeId: string, awayId: string, startMs: number, endMs: number): void {
      const coachIds = new Set<string>([...(teamCoaches.get(homeId) ?? []), ...(teamCoaches.get(awayId) ?? [])]);
      for (const personId of coachIds) {
        const list: BusyInterval[] = busyByPerson.get(personId) ?? [];
        list.push({ start: startMs, end: endMs, eventId: 'pending', eventTitle: 'Game' });
        busyByPerson.set(personId, list);
      }
    }

    // ---- Step 2b: this season's blackouts (migration 0017) — holidays,
    // field closures, standing conflicts. Scoped to the season, not the
    // division, so every division sharing it is protected the same way. ----
    const { data: blackoutRows } = await admin
      .from('blackouts')
      .select('kind, field_name, blackout_date, end_date, days_of_week, day_of_week, start_time, end_time')
      .eq('season_id', input.seasonId);

    const blackouts: BlackoutRow[] = blackoutRows ?? [];

    // ---- Step 2c: field priority reservations (migration 0018). A field
    // that another division outranks this one on, and hasn't been
    // scheduled on yet anywhere in the org, is treated as reserved and
    // skipped entirely for this generation run — this is what turns the
    // old "whichever division generates first wins" behavior into
    // something that actually respects the ranking the admin set up,
    // instead of just being advisory. Fields with no priority rows at all
    // are unaffected — nothing changes for orgs that haven't set this up. ----
    const fieldNamesUsed = Array.from(new Set(input.daySlots.map((s) => s.field)));
    const reservedFieldNames = new Set<string>();
    if (fieldNamesUsed.length > 0) {
      const { data: orgFields } = await admin
        .from('fields')
        .select('id, name')
        .eq('organization_id', input.organizationId);

      const fieldIdByLowerName = new Map((orgFields ?? []).map((f) => [f.name.toLowerCase(), f.id]));
      const relevantFieldIds = fieldNamesUsed
        .map((name) => fieldIdByLowerName.get(name.toLowerCase()))
        .filter((id): id is string => !!id);

      if (relevantFieldIds.length > 0) {
        const { data: priorityRows } = await admin
          .from('field_priorities')
          .select('field_id, division_id, priority')
          .in('field_id', relevantFieldIds);

        // Org-wide, all-time (not just this date range): has each
        // division ever gotten a game on a given field at all?
        const { data: allFieldEvents } = await admin
          .from('events')
          .select('location, division_id')
          .eq('organization_id', input.organizationId)
          .neq('status', 'canceled')
          .not('location', 'is', null)
          .not('division_id', 'is', null);

        const scheduledPairs = new Set(
          (allFieldEvents ?? []).map((e) => `${(e.location as string).toLowerCase()}|${e.division_id}`)
        );

        const idToLowerName = new Map((orgFields ?? []).map((f) => [f.id, f.name.toLowerCase()]));

        for (const fieldId of relevantFieldIds) {
          const rowsForField = (priorityRows ?? []).filter((r) => r.field_id === fieldId);
          if (rowsForField.length === 0) continue;

          const myRow = rowsForField.find((r) => r.division_id === input.divisionId);
          const myPriority = myRow ? myRow.priority : Infinity;

          const outranksMe = rowsForField.filter(
            (r) => r.division_id !== input.divisionId && r.priority < myPriority
          );

          const fieldName = idToLowerName.get(fieldId)!;
          const stillUnclaimed = outranksMe.some((r) => !scheduledPairs.has(`${fieldName}|${r.division_id}`));
          if (stillUnclaimed) {
            reservedFieldNames.add(fieldName);
          }
        }
      }
    }

    // ---- Step 3: build one round-robin cycle, to be repeated across dates ----
    const cycle = buildRoundRobinCycle(teamIds);
    const cycleRounds = cycle.map((round) =>
      round.filter(([a, b]) => a !== null && b !== null) as [string, string][]
    );

    // ---- Step 3b: number every game date into a calendar week (1-based,
    // chronological) using weekStartDay. This used to be driven by when a
    // "round" started — now that placement no longer works in rounds (see
    // Step 4), it's just a calendar grouping: purely a display label
    // (week_number on events), and the same grouping the max-games-per-
    // week cap and the leftover-matchup suggestions below use to know
    // which dates count as the same "week." ----
    const weekNumberByDateKey = new Map<string, number>();
    {
      let nextWeekNumber = 0;
      let lastWeekKey: string | null = null;
      for (const date of gameDates) {
        const wk = getWeekKey(date, weekStartDay);
        if (wk !== lastWeekKey) {
          nextWeekNumber++;
          lastWeekKey = wk;
        }
        weekNumberByDateKey.set(dateKey(date), nextWeekNumber);
      }
    }

    // ---- Step 4: walk every game date in chronological order — weekday
    // and weekend dates interleaved exactly as they fall on the calendar,
    // NOT split into separate "rounds" confined to one or the other (the
    // old round-group system). Every date draws from the same pending
    // queue of matchups, seeded one round-robin cycle at a time and
    // refilled once the current one is fully placed, in fairness order.
    // A date with more open slots (a typical Saturday, say) naturally
    // ends up placing more games than a weekday with just one slot —
    // there's no artificial gate keeping rounds in lockstep with each
    // other or waiting for "their turn." Concretely: whichever dates
    // actually have room carry the load. A blackout, an already-booked
    // slot, or a coach conflict just means fewer chances on THAT one
    // date — the matchup stays in the queue and gets tried again on the
    // very next date with an open, eligible slot, whether that's a
    // weekday or a weekend date. Nothing is ever dropped for a blackout;
    // the season's date range as a whole is the only backstop, not any
    // single date or stretch of them. Whatever's still in the queue once
    // the date range (or the games-per-team target) runs out becomes the
    // "unplaced matchups" list in Step 4b, with suggested open slots for
    // the admin to place by hand. ----
    const eventsToInsert: Array<{
      organization_id: string;
      season_id: string;
      division_id: string;
      type: 'game';
      title: string;
      location: string;
      start_time: string;
      end_time: string;
      home_team_id: string;
      away_team_id: string;
      status: 'draft';
      week_number: number;
    }> = [];

    let roundIndex = -1;
    const pendingQueue: [string, string][] = [];

    let conflictsAvoided = 0;
    let blackoutsSkipped = 0;
    let fieldsReserved = 0;
    let coachConflictsAvoided = 0;
    let weeklyCapDeferred = 0;
    const weekNumbersUsed = new Set<number>();

    // teamId -> calendar-week key (getWeekKey) -> games already placed in
    // that week. Only consulted/updated when maxGamesPerWeek is set —
    // otherwise this stays empty and every lookup is 0, i.e. no cap.
    const gamesThisCalendarWeek = new Map<string, Map<string, number>>();
    function weeklyCountFor(teamId: string, weekKey: string): number {
      return gamesThisCalendarWeek.get(teamId)?.get(weekKey) ?? 0;
    }
    function recordWeeklyGame(teamId: string, weekKey: string): void {
      const perWeek = gamesThisCalendarWeek.get(teamId) ?? new Map<string, number>();
      perWeek.set(weekKey, (perWeek.get(weekKey) ?? 0) + 1);
      gamesThisCalendarWeek.set(teamId, perWeek);
    }

    const gamesPlayed = new Map<string, number>(teamIds.map((id) => [id, 0]));
    const targetReachedFor = () => teamIds.every((id) => (gamesPlayed.get(id) ?? 0) >= input.gamesPerTeam);

    // How many times each team has been HOME so far — used to decide
    // which side of a matchup is home at the moment it's actually
    // placed (see below), not by fixed pair order. buildRoundRobinCycle
    // always puts the same "anchor" team first in its own round-0 slot,
    // so using pair order directly as home/away would give that one
    // team home almost every time all season instead of a roughly even
    // split.
    const homeCount = new Map<string, number>(teamIds.map((id) => [id, 0]));

    // Tops the queue up with the next round-robin cycle whenever it runs
    // dry, unless every team has already reached its target — this is
    // what makes "the round is still accounted for, just try the next
    // date" true: a round's matchups only ever leave the queue by being
    // PLACED, never by being abandoned because of where they happened to
    // fall on the calendar.
    function refillQueueIfEmpty(): void {
      while (pendingQueue.length === 0 && !targetReachedFor()) {
        roundIndex = (roundIndex + 1) % cycleRounds.length;
        pendingQueue.push(...cycleRounds[roundIndex]);
      }
    }

    dateLoop: for (const date of gameDates) {
      if (targetReachedFor()) break;

      const configuredSlots = slotsByDay.get(date.getDay())!;
      const availableSlots = configuredSlots.filter((slot) => {
        if (reservedFieldNames.has(slot.field.toLowerCase())) {
          fieldsReserved++;
          return false;
        }
        if (isBlackedOut(date, slot.time, slot.field, blackouts, timeZone)) {
          blackoutsSkipped++;
          return false;
        }
        const isoTime = zonedDateTimeToIso(date, slot.time, timeZone);
        const taken = occupied.has(`${slot.field}|${isoTime}`);
        if (taken) conflictsAvoided++;
        return !taken;
      });

      if (availableSlots.length === 0) continue;

      const weekKey = getWeekKey(date, weekStartDay);
      const weekNumber = weekNumberByDateKey.get(dateKey(date))!;
      // Which teams already got a slot filled TODAY — a team can't play
      // twice on the same date no matter how many open slots there are.
      const usedTeamsToday = new Set<string>();

      for (const slot of availableSlots) {
        if (targetReachedFor()) break dateLoop;
        refillQueueIfEmpty();
        if (pendingQueue.length === 0) break; // nothing left to schedule at all

        // Scan the queue in fairness order for the first matchup that
        // can actually use THIS slot — not a fixed positional zip, since
        // the front of the queue might be blocked by a coach conflict,
        // a maxed-out weekly cap, or a team that already played today,
        // while something further back fits fine.
        let chosenIdx = -1;
        let chosenIsoTime = '';
        let chosenStartMs = 0;
        let chosenEndMs = 0;

        for (let qi = 0; qi < pendingQueue.length; qi++) {
          // Not home/away yet — that's decided below, once we know a
          // slot actually works for this pair.
          const [teamX, teamY] = pendingQueue[qi];
          if (usedTeamsToday.has(teamX) || usedTeamsToday.has(teamY)) continue;

          if (
            maxGamesPerWeek !== null &&
            (weeklyCountFor(teamX, weekKey) >= maxGamesPerWeek || weeklyCountFor(teamY, weekKey) >= maxGamesPerWeek)
          ) {
            weeklyCapDeferred++;
            continue;
          }

          const isoTime = zonedDateTimeToIso(date, slot.time, timeZone);
          const startMs = new Date(isoTime).getTime();
          const endMs = startMs + input.gameDurationMinutes * 60000;

          if (coachConflictAt(teamX, teamY, startMs, endMs)) {
            coachConflictsAvoided++;
            continue;
          }

          chosenIdx = qi;
          chosenIsoTime = isoTime;
          chosenStartMs = startMs;
          chosenEndMs = endMs;
          break;
        }

        if (chosenIdx === -1) continue; // no eligible matchup fits this slot today — leave it unused

        const [teamX, teamY] = pendingQueue[chosenIdx];
        pendingQueue.splice(chosenIdx, 1);
        usedTeamsToday.add(teamX);
        usedTeamsToday.add(teamY);

        // Whichever side currently has FEWER home games gets to be home
        // this time — a simple greedy balance that keeps every team's
        // home/away split close to even over the course of the season,
        // and naturally alternates home/away on repeat meetings between
        // the same two teams across cycles.
        const homeId = (homeCount.get(teamX) ?? 0) <= (homeCount.get(teamY) ?? 0) ? teamX : teamY;
        const awayId = homeId === teamX ? teamY : teamX;
        homeCount.set(homeId, (homeCount.get(homeId) ?? 0) + 1);

        eventsToInsert.push({
          organization_id: input.organizationId,
          season_id: input.seasonId,
          division_id: input.divisionId,
          type: 'game',
          title: 'Game',
          location: slot.field,
          start_time: chosenIsoTime,
          end_time: new Date(chosenEndMs).toISOString(),
          home_team_id: homeId,
          away_team_id: awayId,
          status: 'draft',
          week_number: weekNumber,
        });
        weekNumbersUsed.add(weekNumber);

        gamesPlayed.set(homeId, (gamesPlayed.get(homeId) ?? 0) + 1);
        gamesPlayed.set(awayId, (gamesPlayed.get(awayId) ?? 0) + 1);

        // Reserve this slot for the rest of this generation run too, in
        // case it's reachable more than once (shouldn't normally
        // happen, but cheap to guard against).
        occupied.add(`${slot.field}|${chosenIsoTime}`);
        recordCoachBusy(homeId, awayId, chosenStartMs, chosenEndMs);
        if (maxGamesPerWeek !== null) {
          recordWeeklyGame(homeId, weekKey);
          recordWeeklyGame(awayId, weekKey);
        }
      }
    }

    // The date range can run out at the exact moment the queue happens
    // to be empty (whatever was queued all got placed) while some teams
    // are STILL short of gamesPerTeam — the next round that would cover
    // that gap was simply never generated, because refillQueueIfEmpty()
    // only runs while there's still a date left to try placing into. Top
    // the queue back up here, purely so Step 4b below can actually see
    // and report what's still needed — nothing more gets scheduled from
    // this point on.
    //
    // Stop as soon as every team's ALREADY-PLACED games plus its
    // games currently sitting in the queue covers its target — NOT
    // targetReachedFor(), which only tracks placed games and would
    // never become true here since nothing more actually gets placed
    // after this point. Using that would enqueue whole extra cycles
    // forever (bounded only by a safety cap), producing a wildly
    // oversized, useless "unplaced" list instead of just the handful
    // of games actually still needed.
    const queuedCount = new Map<string, number>(teamIds.map((id) => [id, 0]));
    for (const [a, b] of pendingQueue) {
      queuedCount.set(a, (queuedCount.get(a) ?? 0) + 1);
      queuedCount.set(b, (queuedCount.get(b) ?? 0) + 1);
    }
    const stillShort = () =>
      teamIds.some((id) => (gamesPlayed.get(id) ?? 0) + (queuedCount.get(id) ?? 0) < input.gamesPerTeam);
    let topUpRounds = 0;
    while (stillShort() && topUpRounds < cycleRounds.length * 4) {
      roundIndex = (roundIndex + 1) % cycleRounds.length;
      const nextRound = cycleRounds[roundIndex];
      pendingQueue.push(...nextRound);
      for (const [a, b] of nextRound) {
        queuedCount.set(a, (queuedCount.get(a) ?? 0) + 1);
        queuedCount.set(b, (queuedCount.get(b) ?? 0) + 1);
      }
      topUpRounds++;
    }

    // ---- Step 4b: matchups that never found a home within the date
    // range — gather them, plus a few real open (date/time/field)
    // suggestions each, so the admin can place them by hand instead of
    // just seeing "not everyone reached the target." Only matchups where
    // BOTH teams still need a game are reported — if one side already
    // hit its target, this specific pairing isn't actually required
    // anymore. A suggested slot has to land in a week where NEITHER team
    // already has a game (from this run, or an existing published game
    // for this division) — the point is a bonus/makeup game that doesn't
    // double up a week that's already spoken for — and still passes
    // every other check a normal placement would (not blacked out, not
    // reserved, not already taken, no coach conflict). These are
    // suggestions only; nothing is created here — see the "Schedule"
    // action in the Season Builder UI. ----
    const teamWeekCommitments = new Map<string, Set<string>>();
    function recordCommitment(teamId: string | null, startTimeIso: string): void {
      if (!teamId) return;
      const wk = getWeekKey(new Date(startTimeIso), weekStartDay);
      const set = teamWeekCommitments.get(teamId) ?? new Set<string>();
      set.add(wk);
      teamWeekCommitments.set(teamId, set);
    }
    for (const ev of eventsToInsert) {
      recordCommitment(ev.home_team_id, ev.start_time);
      recordCommitment(ev.away_team_id, ev.start_time);
    }
    const teamIdSet = new Set(teamIds);
    for (const ev of relevantExistingEvents) {
      if (ev.home_team_id && teamIdSet.has(ev.home_team_id)) recordCommitment(ev.home_team_id, ev.start_time);
      if (ev.away_team_id && teamIdSet.has(ev.away_team_id)) recordCommitment(ev.away_team_id, ev.start_time);
    }

    const MAX_SUGGESTIONS_PER_MATCHUP = 3;
    const unplacedMatchups: UnplacedMatchup[] = pendingQueue
      .filter(
        ([teamX, teamY]) =>
          (gamesPlayed.get(teamX) ?? 0) < input.gamesPerTeam && (gamesPlayed.get(teamY) ?? 0) < input.gamesPerTeam
      )
      .map(([teamX, teamY]) => {
        // Same greedy home/away balance as the real placement loop above,
        // based on home counts as they actually stand — a suggestion, not
        // a placement, so this doesn't update homeCount itself.
        const homeTeamId = (homeCount.get(teamX) ?? 0) <= (homeCount.get(teamY) ?? 0) ? teamX : teamY;
        const awayTeamId = homeTeamId === teamX ? teamY : teamX;

        const candidateSlots: UnplacedMatchup['candidateSlots'] = [];
        for (const date of gameDates) {
          if (candidateSlots.length >= MAX_SUGGESTIONS_PER_MATCHUP) break;
          const wk = getWeekKey(date, weekStartDay);
          if (teamWeekCommitments.get(teamX)?.has(wk) || teamWeekCommitments.get(teamY)?.has(wk)) continue;

          const configuredSlots = slotsByDay.get(date.getDay());
          if (!configuredSlots) continue;

          for (const slot of configuredSlots) {
            if (reservedFieldNames.has(slot.field.toLowerCase())) continue;
            if (isBlackedOut(date, slot.time, slot.field, blackouts, timeZone)) continue;
            const isoTime = zonedDateTimeToIso(date, slot.time, timeZone);
            if (occupied.has(`${slot.field}|${isoTime}`)) continue;
            const startMs = new Date(isoTime).getTime();
            const endMs = startMs + input.gameDurationMinutes * 60000;
            if (coachConflictAt(teamX, teamY, startMs, endMs)) continue;

            candidateSlots.push({
              startTime: isoTime,
              field: slot.field,
              weekNumber: weekNumberByDateKey.get(dateKey(date))!,
            });
            if (candidateSlots.length >= MAX_SUGGESTIONS_PER_MATCHUP) break;
          }
        }
        return { homeTeamId, awayTeamId, candidateSlots };
      });

    if (eventsToInsert.length === 0) {
      if (fieldsReserved > 0 && reservedFieldNames.size === fieldNamesUsed.length) {
        return {
          error:
            'Every field this division is set up to use is currently reserved for a higher-priority division that hasn\'t been scheduled yet. Generate that division\'s schedule first, or adjust field priority.',
        };
      }
      return { error: 'Every configured slot in that date range is already taken by another event.' };
    }

    // ---- Step 5: replace this division's previous DRAFT games with the
    // freshly computed set — this is what makes "Generate" mean
    // "regenerate from current teams/blackouts/priorities" instead of
    // silently piling duplicate games on top of the old ones. Only
    // reaches here once eventsToInsert is confirmed non-empty, so a
    // generation that fails to produce anything never wipes out a
    // working draft schedule. PUBLISHED games are never touched — those
    // are treated as committed and are only removed manually. ----
    const { data: deletedRows, error: deleteError } = await admin
      .from('events')
      .delete()
      .eq('division_id', input.divisionId)
      .eq('type', 'game')
      .eq('status', 'draft')
      .select('id');

    if (deleteError) {
      return { error: `Failed to clear the previous draft schedule: ${deleteError.message}` };
    }

    const replacedCount = deletedRows?.length ?? 0;

    const { error } = await admin.from('events').insert(eventsToInsert);

    if (error) {
      return { error: `Failed to create schedule: ${error.message}` };
    }

    // ---- Step 6: remember these inputs (migration 0019) so the Season
    // Builder form can restore them next time instead of starting blank,
    // and so a later regenerate is a single click. Best-effort — the
    // schedule itself already succeeded above, so a failure here doesn't
    // fail the whole generation, it just means the form won't pre-fill
    // next visit. The error IS still captured and surfaced (rather than
    // silently discarded) so a schema drift — e.g. a migration adding a
    // column this upsert writes, like max_games_per_week/week_start_day
    // in 0024, not yet applied to this database — shows up as a visible
    // warning instead of quietly losing every setting from here on,
    // including ones that used to save fine before this write started
    // referencing the new columns. ----
    const { error: settingsSaveError } = await admin.from('schedule_generation_settings').upsert(
      {
        organization_id: input.organizationId,
        division_id: input.divisionId,
        day_slots: input.daySlots,
        games_per_team: input.gamesPerTeam,
        game_duration_minutes: input.gameDurationMinutes,
        start_date: input.startDate,
        end_date: input.endDate,
        max_games_per_week: maxGamesPerWeek,
        week_start_day: weekStartDay,
        priority_day_of_week: priorityDayOfWeek,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'division_id' }
    );
    if (settingsSaveError) {
      console.error('Failed to save schedule generation settings for next visit:', settingsSaveError);
    }

    return {
      gamesCreated: eventsToInsert.length,
      replacedCount,
      weeksScheduled: weekNumbersUsed.size,
      conflictsAvoided,
      blackoutsSkipped,
      fieldsReserved,
      coachConflictsAvoided,
      weeklyCapDeferred,
      targetReached: targetReachedFor(),
      unplacedMatchups,
      settingsSaveWarning: settingsSaveError ? settingsSaveError.message : undefined,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
