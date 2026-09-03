-- 0026_priority_day_of_week.sql
--
-- Lets a division mark one weekday (e.g. Saturday) as the day the
-- auto-scheduler should fill FIRST within every calendar week, so a
-- team's weekly game allotment (see max_games_per_week, 0024) lands on
-- that day whenever there's enough slot capacity there, instead of
-- whichever configured day happens to come first chronologically that
-- week.
--
-- Nullable: null means no priority day (today's behavior, unchanged —
-- dates fill in plain chronological order). 0=Sunday..6=Saturday, same
-- convention as week_start_day (0024), day_of_week (blackouts, 0017),
-- and day_slots (0019).

alter table schedule_generation_settings
  add column priority_day_of_week int
    constraint schedule_generation_settings_priority_day_of_week_check
    check (priority_day_of_week between 0 and 6);

comment on column schedule_generation_settings.priority_day_of_week is
  'Optional weekday (0=Sunday..6=Saturday) the auto-scheduler fills first within each calendar week, so a team''s weekly game allotment lands there whenever slot capacity allows. Null = no priority day, dates fill in plain chronological order.';
