'use server';

// lib/actions/auto-schedule.ts
//
// Generates a full SEASON-LONG schedule, not a single round-robin pass.
// A rec league season needs teams to play repeatedly across many weeks,
// so this builds one fair round-robin cycle (every team plays every team
// once) and then REPEATS that cycle across every available game date
// until the season's date range is filled — spreading games evenly
// rather than compressing everyone's matchups into the first week or two.
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
  startDate: string; // "2026-09-01"
  endDate: string; // "2026-11-15"
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

function formatDateAtTime(date: Date, time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

type GenerateScheduleResult =
  | { gamesCreated: number; seasonDatesUsed: number; conflictsAvoided: number }
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
    // one configured slot for its day of week ----
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
    // the next date(s) before advancing to the next round. Slots already
    // taken by another event (any division) are skipped entirely. ----
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
    }> = [];
    let roundIndex = 0;
    let pendingMatchups: [string, string][] = [...cycleRounds[0]];
    let conflictsAvoided = 0;

    for (const date of gameDates) {
      const configuredSlots = slotsByDay.get(date.getDay())!;

      const availableSlots = configuredSlots.filter((slot) => {
        const isoTime = formatDateAtTime(date, slot.time);
        const taken = occupied.has(`${slot.field}|${isoTime}`);
        if (taken) conflictsAvoided++;
        return !taken;
      });

      if (availableSlots.length === 0) continue;

      if (pendingMatchups.length === 0) {
        roundIndex = (roundIndex + 1) % cycleRounds.length;
        pendingMatchups = [...cycleRounds[roundIndex]];
      }

      const forThisDate = pendingMatchups.splice(0, availableSlots.length);
      forThisDate.forEach(([homeId, awayId], i) => {
        const slot = availableSlots[i];
        const isoTime = formatDateAtTime(date, slot.time);

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
        });

        // Reserve this slot for the rest of this generation run too, in
        // case it's reachable more than once (shouldn't normally happen,
        // but cheap to guard against).
        occupied.add(`${slot.field}|${isoTime}`);
      });
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
      seasonDatesUsed: gameDates.length,
      conflictsAvoided,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
