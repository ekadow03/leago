'use server';

// lib/actions/auto-schedule.ts
//
// Generates a full SEASON-LONG schedule, not a single round-robin pass.
// A rec league season needs teams to play repeatedly across many weeks,
// so this builds one fair round-robin cycle (every team plays every team
// once) and then REPEATS that cycle across every available game date
// until the season's date range is filled — spreading games evenly
// rather than compressing everyone's matchups into the first week or two.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

interface GenerateScheduleInput {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  daysOfWeek: number[]; // 0 = Sunday .. 6 = Saturday
  times: string[]; // "18:00", "19:30", etc — 24hr format, sorted chronologically by caller
  fields: string[]; // location names, e.g. ["Field 1", "Field 2"]
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

type GenerateScheduleResult = { gamesCreated: number; seasonDatesUsed: number } | { error: string };

export async function generateSeasonSchedule(
  input: GenerateScheduleInput
): Promise<GenerateScheduleResult> {
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) {
    return { error: 'Only an organization admin can generate a schedule.' };
  }

  if (input.daysOfWeek.length === 0) return { error: 'Select at least one day of the week.' };
  if (input.times.length === 0) return { error: 'Add at least one time slot.' };
  if (input.fields.length === 0) return { error: 'Add at least one field.' };

  const admin = createAdminClient();

  const { data: teams } = await admin
    .from('teams')
    .select('id')
    .eq('division_id', input.divisionId);

  const teamIds = (teams ?? []).map((t) => t.id);
  if (teamIds.length < 2) {
    return { error: 'Need at least 2 teams in this division to generate a schedule.' };
  }

  // ---- Step 1: every actual calendar date in range matching selected weekdays ----
  const gameDates: Date[] = [];
  const cursor = new Date(input.startDate + 'T00:00:00');
  const end = new Date(input.endDate + 'T00:00:00');
  while (cursor <= end) {
    if (input.daysOfWeek.includes(cursor.getDay())) {
      gameDates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (gameDates.length === 0) {
    return { error: 'No game dates fall within that range on the selected days of the week.' };
  }

  // ---- Step 2: how many game slots exist on any single date ----
  const slotsPerDate = input.times.length * input.fields.length;

  // ---- Step 3: build one round-robin cycle, to be repeated across dates ----
  const cycle = buildRoundRobinCycle(teamIds);
  const cycleRounds = cycle.map((round) =>
    round.filter(([a, b]) => a !== null && b !== null) as [string, string][]
  );

  // ---- Step 4: walk game dates in order, placing one ROUND per date (not
  // one slot-fill-everything pass) — this is what keeps a rec season
  // realistic: each team plays once on a given game day, not multiple
  // times just because extra fields/times happened to be available. A
  // round that's too big for one date's slots spills onto the next
  // date(s) before advancing to the next round. ----
  const eventsToInsert: any[] = [];
  let roundIndex = 0;
  let pendingMatchups: [string, string][] = [...cycleRounds[0]];

  for (const date of gameDates) {
    if (pendingMatchups.length === 0) {
      roundIndex = (roundIndex + 1) % cycleRounds.length;
      pendingMatchups = [...cycleRounds[roundIndex]];
    }

    const forThisDate = pendingMatchups.splice(0, slotsPerDate);
    let slotCursor = 0;
    for (const [homeId, awayId] of forThisDate) {
      const time = input.times[slotCursor % input.times.length];
      const field = input.fields[Math.floor(slotCursor / input.times.length) % input.fields.length];
      slotCursor++;

      eventsToInsert.push({
        organization_id: input.organizationId,
        season_id: input.seasonId,
        division_id: input.divisionId,
        type: 'game',
        title: 'Game',
        location: field,
        start_time: formatDateAtTime(date, time),
        home_team_id: homeId,
        away_team_id: awayId,
        status: 'draft',
      });
    }
  }

  const { error } = await admin.from('events').insert(eventsToInsert);

  if (error) {
    return { error: `Failed to create schedule: ${error.message}` };
  }

  return { gamesCreated: eventsToInsert.length, seasonDatesUsed: gameDates.length };
}
