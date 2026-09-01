-- 0014_event_week_number.sql
--
-- Adds a "week number" label to events, driven by generateSeasonSchedule().
-- This is NOT a real calendar week — it increments once per distinct game
-- date the scheduler processes, so a division playing twice in the same
-- real week (a weekday game and a weekend game) gets "Week 1" for the
-- weekday game and "Week 2" for the weekend game, then "Week 3" for the
-- following weekday game, and so on — matching how youth sports leagues
-- commonly label a team's schedule regardless of real calendar weeks.
-- Null for manually created events, which don't participate in this
-- numbering.

alter table events add column week_number int;

comment on column events.week_number is
  'Sequential schedule-display label set by generateSeasonSchedule() — '
  'increments per distinct game date in that generation run, not per '
  'real calendar week. Null for manually created events.';
