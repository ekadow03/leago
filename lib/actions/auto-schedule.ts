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
import { requireOrgAdmin } from '@/lib/org-context';

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
  startDate: string; // "2026-09-01"
  endDate: string; // "2026-11-15" — a hard cap, not a target
  // IANA zone (e.g. "America/Los_Angeles"), read from the admin's own
  // browser via Intl.DateTimeFormat().resolvedOptions().timeZone. This
  // runs as a server action, and the server's own clock is UTC (Vercel) —
  // without this, "5pm" would get stamped as 5pm UTC instead of 5pm in
  // the league's actual timezone. Falls back to UTC if somehow missing.
  timeZone?: string;
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
      weeksScheduled: number;
      conflictsAvoided: number;
      blackoutsSkipped: number;
      targetReached: boolean;
    }
  | { error: string };

export async function generateSeasonSchedule(input: GenerateScheduleInput): Promise<GenerateScheduleResult> {
  try {
    const isAdmin = await requireOrgAdmin(input.organizationId);
    if (!isAdmin) {
      return { error: 'Only an organization admin can generate a schedule.' };
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

    const timeZone = input.timeZone || 'UTC';

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

    // ---- Step 2: existing events across the WHOLE organization (any
    // season, any division) in this date range, so a field shared with
    // another division doesn't get double-booked ----
    const { data: existingEvents } = await admin
      .from('events')
      .select('location, start_time')
      .eq('organization_id', input.organizationId)
      .neq('status', 'canceled')
      .not('location', 'is', null)
      .gte('start_time', new Date(input.startDate + 'T00:00:00').toISOString())
      .lte('start_time', new Date(input.endDate + 'T23:59:59').toISOString());

    const occupied = new Set((existingEvents ?? []).map((e) => `${e.location}|${e.start_time}`));

    // ---- Step 2b: this season's blackouts (migration 0017) — holidays,
    // field closures, standing conflicts. Scoped to the season, not the
    // division, so every division sharing it is protected the same way. ----
    const { data: blackoutRows } = await admin
      .from('blackouts')
      .select('kind, field_name, blackout_date, day_of_week, start_time, end_time')
      .eq('season_id', input.seasonId);

    const blackouts: BlackoutRow[] = blackoutRows ?? [];

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
    // week_number tracks the ROUND, not the calendar date: every team
    // plays at most once per round, so the round index IS "which numbered
    // game is this for the team" — exactly the weekday/weekend-game
    // numbering the feature was built for. It only increments when a
    // fresh round actually starts being placed. A round that spills across
    // two calendar dates (like a Monday game finishing on Wednesday
    // because Monday only had one open slot) keeps the SAME week number
    // across both dates — they're still that round's games. A date with
    // zero open slots (fully conflict-blocked) doesn't consume a week
    // number either, since nothing happened on it for anyone. Stops as
    // soon as every team has reached gamesPerTeam (or the date range runs
    // out first). ----
    const eventsToInsert: Array<{
      organization_id: string;
      season_id: string;
      division_id: string;
      type: 'game';
      title: string;
      location: string;
      start_time: string;
      home_team_id: string;
      away_team_id: string;
      status: 'draft';
      week_number: number;
    }> = [];
    let roundIndex = 0;
    let pendingMatchups: [string, string][] = [...cycleRounds[0]];
    let conflictsAvoided = 0;
    let blackoutsSkipped = 0;
    let weekNumber = 1; // round 0 is already "week" 1

    const gamesPlayed = new Map<string, number>(teamIds.map((id) => [id, 0]));
    const targetReachedFor = () =>
      teamIds.every((id) => (gamesPlayed.get(id) ?? 0) >= input.gamesPerTeam);

    for (const date of gameDates) {
      const configuredSlots = slotsByDay.get(date.getDay())!;
      const availableSlots = configuredSlots.filter((slot) => {
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

      if (pendingMatchups.length === 0) {
        roundIndex = (roundIndex + 1) % cycleRounds.length;
        pendingMatchups = [...cycleRounds[roundIndex]];
        weekNumber++;
      }

      const forThisDate = pendingMatchups.splice(0, availableSlots.length);
      forThisDate.forEach(([homeId, awayId], i) => {
        const slot = availableSlots[i];
        const isoTime = zonedDateTimeToIso(date, slot.time, timeZone);

        eventsToInsert.push({
          organization_id: input.organizationId,
          season_id: input.seasonId,
          division_id: input.divisionId,
          type: 'game',
          title: 'Game',
          location: slot.field,
          start_time: isoTime,
          home_team_id: homeId,
          away_team_id: awayId,
          status: 'draft',
          week_number: weekNumber,
        });

        gamesPlayed.set(homeId, (gamesPlayed.get(homeId) ?? 0) + 1);
        gamesPlayed.set(awayId, (gamesPlayed.get(awayId) ?? 0) + 1);

        // Reserve this slot for the rest of this generation run too, in
        // case it's reachable more than once (shouldn't normally happen,
        // but cheap to guard against).
        occupied.add(`${slot.field}|${isoTime}`);
      });

      if (targetReachedFor()) break;
    }

    if (eventsToInsert.length === 0) {
      return { error: 'Every configured slot in that date range is already taken by another event.' };
    }

    const { error } = await admin.from('events').insert(eventsToInsert);

    if (error) {
      return { error: `Failed to create schedule: ${error.message}` };
    }

    return {
      gamesCreated: eventsToInsert.length,
      weeksScheduled: weekNumber,
      conflictsAvoided,
      blackoutsSkipped,
      targetReached: targetReachedFor(),
    };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
