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
// Every game created in one generation run also gets a week_number —
// see the comment on that column (migration 0014) for what it means and
// why it isn't a real calendar week.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';
import { getOrgTeamCoaches, buildCoachBusyIntervals, intervalsOverlap, type BusyInterval } from '@/lib/scheduling-conflicts';

interface DaySlotInput {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  time: string; // "18:00", "19:30", etc — 24hr format
  field: string; // location name, e.g. "Field 1"
  // Which independent round-robin track this day belongs to (migration-
  // free — stored as-is inside schedule_generation_settings.day_slots
  // jsonb). Days in the same group share ONE continuous round-robin
  // queue; days in different groups each cycle through their own,
  // completely independent of the other group's slot availability. This
  // is what lets "weeknight games" be one round and "Saturday's full
  // slate" be a separate round, instead of Saturday's extra capacity
  // finishing off a weeknight round that started earlier in the week.
  // Defaults to 'A' (a single shared group — today's behavior) when
  // omitted, so callers/saved settings from before this feature work
  // unchanged.
  roundGroup?: string;
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
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
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

  const dateStr = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const slotMs = new Date(zonedDateTimeToIso(date, time, timeZone)).getTime();

  for (const b of blackouts) {
    if (b.field_name && b.field_name.toLowerCase() !== field.toLowerCase()) continue;

    let dayMatches = false;
    if (b.kind === 'date') dayMatches = b.blackout_date === dateStr;
    else if (b.kind === 'weekly') dayMatches = b.day_of_week === date.getDay();
    else if (b.kind === 'daily') dayMatches = true;
    if (!dayMatches) continue;

    if (!b.start_time || !b.end_time) return true; // whole day/occurrence blocked

    const startMs = new Date(zonedDateTimeToIso(date, b.start_time, timeZone)).getTime();
    const endMs = new Date(zonedDateTimeToIso(date, b.end_time, timeZone)).getTime();
    if (slotMs >= startMs && slotMs < endMs) return true;
  }

  return false;
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

    const timeZone = input.timeZone || 'UTC';
    const weekStartDay = input.weekStartDay ?? 0;
    const maxGamesPerWeek =
      input.maxGamesPerWeek !== undefined && input.maxGamesPerWeek !== null ? input.maxGamesPerWeek : null;

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

    // Which round-robin track each day of week feeds into — a day's
    // group is whatever its slots say (the Season Builder assigns one
    // group per day, not per slot, so the first slot seen for a day is
    // authoritative), defaulting to 'A' for a day with no group set at
    // all. See the round-placement loop below for how groups stay
    // independent of each other.
    const dayToGroup = new Map<number, string>();
    for (const [day, slots] of slotsByDay.entries()) {
      dayToGroup.set(day, slots[0]?.roundGroup || 'A');
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
      .select('kind, field_name, blackout_date, day_of_week, start_time, end_time')
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

    // ---- Step 4: walk game dates in order, placing one ROUND per date
    // (not one slot-fill-everything pass) — this is what keeps a rec
    // season realistic: each team plays once on a given game day, not
    // multiple times just because extra slots happened to be available.
    // A round that's too big for one date's available slots spills onto
    // the next date(s) before advancing to the next round.
    //
    // Each round-robin GROUP (dayToGroup above) runs its own completely
    // independent round-robin cycle: its own roundIndex, its own queue of
    // matchups still owed for the round it's currently on. A weeknight
    // group and a Saturday group therefore never share a round with each
    // other — a Saturday with lots of spare field capacity can't "help
    // finish" a weeknight round, it just starts (or continues) its OWN
    // round using only its own slots. Groups that were never split apart
    // (the default — every day defaults to group 'A') behave exactly as
    // before this feature existed: one single continuous round-robin
    // queue across every configured day.
    //
    // week_number is a display label, not a calendar week: it's handed
    // out from one shared counter (nextWeekNumber) the moment ANY group
    // starts a fresh round, so whichever group's round starts first gets
    // the lower number — e.g. a weeknight round starting mid-week gets
    // "Week 1" and the following Saturday's separate round gets "Week 2"
    // even though they're the same real calendar week. A round that
    // spills across multiple dates WITHIN its own group keeps that same
    // week number across all of them. A date with zero open slots
    // (fully conflict-blocked) doesn't consume anything, since nothing
    // happened on it for anyone. Stops as soon as every team has reached
    // gamesPerTeam (or the date range runs out first). ----
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

    interface GroupRoundState {
      roundIndex: number;
      pendingMatchups: [string, string][];
      currentWeekNumber: number; // 0 until this group's first round starts
    }
    const groupRoundState = new Map<string, GroupRoundState>();
    function stateForGroup(groupId: string): GroupRoundState {
      let state = groupRoundState.get(groupId);
      if (!state) {
        state = { roundIndex: -1, pendingMatchups: [], currentWeekNumber: 0 };
        groupRoundState.set(groupId, state);
      }
      return state;
    }
    let nextWeekNumber = 1;

    let conflictsAvoided = 0;
    let blackoutsSkipped = 0;
    let fieldsReserved = 0;
    let coachConflictsAvoided = 0;
    let weeklyCapDeferred = 0;

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
    const targetReachedFor = () =>
      teamIds.every((id) => (gamesPlayed.get(id) ?? 0) >= input.gamesPerTeam);

    for (const date of gameDates) {
      const groupId = dayToGroup.get(date.getDay()) ?? 'A';
      const state = stateForGroup(groupId);

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

      if (state.pendingMatchups.length === 0) {
        state.roundIndex = (state.roundIndex + 1) % cycleRounds.length;
        state.pendingMatchups = [...cycleRounds[state.roundIndex]];
        state.currentWeekNumber = nextWeekNumber++;
      }

      // Pair today's matchups with today's slots one at a time (not a
      // fixed positional zip) — a coach on two teams means SOME matchup
      // in this round may not have a conflict-free slot today at all, in
      // which case it's deferred to the next game date (in this SAME
      // group) instead of silently double-booking them. usedSlotIndices
      // tracks which of today's slots another matchup already claimed.
      const matchupsToTry = [...state.pendingMatchups];
      state.pendingMatchups = [];
      const usedSlotIndices = new Set<number>();
      const weekKey = maxGamesPerWeek !== null ? getWeekKey(date, weekStartDay) : '';

      for (const [homeId, awayId] of matchupsToTry) {
        // A per-team weekly cap (migration 0024) applies to the whole
        // date, not a specific slot — if either side of this matchup has
        // already reached it for this calendar week, no slot today will
        // help, so defer straight to a later date (a later date may fall
        // in the following week, where the count resets) instead of
        // burning a slot search.
        if (
          maxGamesPerWeek !== null &&
          (weeklyCountFor(homeId, weekKey) >= maxGamesPerWeek || weeklyCountFor(awayId, weekKey) >= maxGamesPerWeek)
        ) {
          weeklyCapDeferred++;
          state.pendingMatchups.push([homeId, awayId]);
          continue;
        }

        let chosenSlotIndex: number | null = null;
        let chosenIsoTime = '';
        let chosenStartMs = 0;
        let chosenEndMs = 0;

        for (let i = 0; i < availableSlots.length; i++) {
          if (usedSlotIndices.has(i)) continue;
          const slot = availableSlots[i];
          const isoTime = zonedDateTimeToIso(date, slot.time, timeZone);
          const startMs = new Date(isoTime).getTime();
          const endMs = startMs + input.gameDurationMinutes * 60000;

          if (coachConflictAt(homeId, awayId, startMs, endMs)) {
            coachConflictsAvoided++;
            continue;
          }

          chosenSlotIndex = i;
          chosenIsoTime = isoTime;
          chosenStartMs = startMs;
          chosenEndMs = endMs;
          break;
        }

        if (chosenSlotIndex === null) {
          // No conflict-free slot today for this matchup — try again on
          // a later date (still this same group) rather than forcing a
          // coach into two games at once.
          state.pendingMatchups.push([homeId, awayId]);
          continue;
        }

        usedSlotIndices.add(chosenSlotIndex);
        const slot = availableSlots[chosenSlotIndex];
        const endIso = new Date(chosenEndMs).toISOString();

        eventsToInsert.push({
          organization_id: input.organizationId,
          season_id: input.seasonId,
          division_id: input.divisionId,
          type: 'game',
          title: 'Game',
          location: slot.field,
          start_time: chosenIsoTime,
          end_time: endIso,
          home_team_id: homeId,
          away_team_id: awayId,
          status: 'draft',
          week_number: state.currentWeekNumber,
        });

        gamesPlayed.set(homeId, (gamesPlayed.get(homeId) ?? 0) + 1);
        gamesPlayed.set(awayId, (gamesPlayed.get(awayId) ?? 0) + 1);

        // Reserve this slot for the rest of this generation run too, in
        // case it's reachable more than once (shouldn't normally happen,
        // but cheap to guard against).
        occupied.add(`${slot.field}|${chosenIsoTime}`);
        recordCoachBusy(homeId, awayId, chosenStartMs, chosenEndMs);
        if (maxGamesPerWeek !== null) {
          recordWeeklyGame(homeId, weekKey);
          recordWeeklyGame(awayId, weekKey);
        }
      }

      if (targetReachedFor()) break;
    }

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
    // next visit. ----
    await admin.from('schedule_generation_settings').upsert(
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'division_id' }
    );

    return {
      gamesCreated: eventsToInsert.length,
      replacedCount,
      weeksScheduled: nextWeekNumber - 1,
      conflictsAvoided,
      blackoutsSkipped,
      fieldsReserved,
      coachConflictsAvoided,
      weeklyCapDeferred,
      targetReached: targetReachedFor(),
    };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
