// lib/scheduling-conflicts.ts
//
// Shared by lib/actions/events.ts (single manual game/practice) and
// lib/actions/auto-schedule.ts (season generator) — a coach can be on
// the staff of more than one team (0023_team_staff.sql), including
// teams in DIFFERENT divisions than each other, so neither a single
// division's data nor a single team's data is enough on its own to
// know whether a given time slot double-books someone. This looks
// across the WHOLE organization's teams/events, not just one division.

import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface BusyInterval {
  start: number; // epoch ms
  end: number; // epoch ms
  eventId: string;
  eventTitle: string;
}

/** team_id -> set of person_ids on that team's staff, for every team in
 * this org (every division, every season) — a coach conflict check has
 * to cross divisions, so this deliberately isn't scoped to one. */
export async function getOrgTeamCoaches(
  admin: AdminClient,
  organizationId: string
): Promise<Map<string, Set<string>>> {
  const teamCoaches = new Map<string, Set<string>>();

  const { data: seasons } = await admin.from('seasons').select('id').eq('organization_id', organizationId);
  const seasonIds = (seasons ?? []).map((s: any) => s.id as string);
  if (seasonIds.length === 0) return teamCoaches;

  const { data: divisions } = await admin.from('divisions').select('id').in('season_id', seasonIds);
  const divisionIds = (divisions ?? []).map((d: any) => d.id as string);
  if (divisionIds.length === 0) return teamCoaches;

  const { data: teams } = await admin.from('teams').select('id').in('division_id', divisionIds);
  const teamIds = (teams ?? []).map((t: any) => t.id as string);
  if (teamIds.length === 0) return teamCoaches;

  const { data: staffRows } = await admin.from('team_staff').select('team_id, person_id').in('team_id', teamIds);

  for (const row of (staffRows ?? []) as { team_id: string; person_id: string }[]) {
    if (!teamCoaches.has(row.team_id)) teamCoaches.set(row.team_id, new Set());
    teamCoaches.get(row.team_id)!.add(row.person_id);
  }

  return teamCoaches;
}

export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

interface EventRow {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
}

/** Turns a set of events into a per-coach busy schedule. An event with
 * no end_time (shouldn't normally happen — both callers always stamp
 * one — but events.ts's create form technically allows omitting it)
 * gets a fallback duration so it still blocks a reasonable window
 * instead of being treated as instantaneous. */
export function buildCoachBusyIntervals(
  events: EventRow[],
  teamCoaches: Map<string, Set<string>>,
  fallbackDurationMs: number
): Map<string, BusyInterval[]> {
  const busyByPerson = new Map<string, BusyInterval[]>();

  for (const ev of events) {
    const teamIds = [ev.home_team_id, ev.away_team_id].filter((id): id is string => !!id);
    if (teamIds.length === 0) continue;

    const start = new Date(ev.start_time).getTime();
    const end = ev.end_time ? new Date(ev.end_time).getTime() : start + fallbackDurationMs;

    const coachIds = new Set<string>();
    for (const teamId of teamIds) {
      for (const personId of teamCoaches.get(teamId) ?? []) coachIds.add(personId);
    }

    for (const personId of coachIds) {
      if (!busyByPerson.has(personId)) busyByPerson.set(personId, []);
      busyByPerson.get(personId)!.push({ start, end, eventId: ev.id, eventTitle: ev.title });
    }
  }

  return busyByPerson;
}

export interface CoachConflict {
  personId: string;
  personName: string;
  conflictingEventId: string;
  conflictingEventTitle: string;
  conflictingStart: string;
}

/** Single-event conflict check for lib/actions/events.ts — fetches just
 * enough of the org's schedule (a window around this one event, not the
 * whole season) to check it. Not used by the auto-scheduler, which
 * evaluates far more candidate slots and needs the busy-interval maps
 * built once up front instead of requeried per slot — see
 * buildCoachBusyIntervals/getOrgTeamCoaches used directly there. */
export async function findCoachConflictsForEvent(
  admin: AdminClient,
  organizationId: string,
  params: {
    excludeEventId?: string;
    startTime: string;
    endTime: string | null;
    homeTeamId: string | null;
    awayTeamId: string | null;
    fallbackDurationMs: number;
  }
): Promise<CoachConflict[]> {
  const teamIds = [params.homeTeamId, params.awayTeamId].filter((id): id is string => !!id);
  if (teamIds.length === 0) return [];

  const teamCoaches = await getOrgTeamCoaches(admin, organizationId);
  const coachIds = new Set<string>();
  for (const teamId of teamIds) {
    for (const personId of teamCoaches.get(teamId) ?? []) coachIds.add(personId);
  }
  if (coachIds.size === 0) return [];

  const startMs = new Date(params.startTime).getTime();
  const endMs = params.endTime ? new Date(params.endTime).getTime() : startMs + params.fallbackDurationMs;

  // A conflicting event has to start within a day of this one either
  // way for its time range to possibly overlap — narrows the query
  // instead of pulling the org's entire event history.
  const windowStart = new Date(startMs - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(endMs + 24 * 60 * 60 * 1000).toISOString();

  const { data: events } = await admin
    .from('events')
    .select('id, title, start_time, end_time, home_team_id, away_team_id')
    .eq('organization_id', organizationId)
    .neq('status', 'canceled')
    .gte('start_time', windowStart)
    .lte('start_time', windowEnd);

  const relevant = (events ?? []).filter((e) => e.id !== params.excludeEventId) as EventRow[];
  const busyByPerson = buildCoachBusyIntervals(relevant, teamCoaches, params.fallbackDurationMs);

  const { data: people } = await admin.from('people').select('id, first_name, last_name').in('id', Array.from(coachIds));
  const nameById = new Map((people ?? []).map((p: any) => [p.id, `${p.first_name} ${p.last_name}`]));

  const conflicts: CoachConflict[] = [];
  for (const personId of coachIds) {
    for (const busy of busyByPerson.get(personId) ?? []) {
      if (intervalsOverlap(startMs, endMs, busy.start, busy.end)) {
        conflicts.push({
          personId,
          personName: nameById.get(personId) ?? 'Someone on staff',
          conflictingEventId: busy.eventId,
          conflictingEventTitle: busy.eventTitle,
          conflictingStart: new Date(busy.start).toISOString(),
        });
      }
    }
  }

  return conflicts;
}
