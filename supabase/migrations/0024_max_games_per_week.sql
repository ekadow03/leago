-- 0024_max_games_per_week.sql
--
-- Lets a division cap how many games a single team can play within one
-- calendar week when auto-generating a schedule, and lets the admin pick
-- which weekday starts that week (Sun-Sat, Mon-Sun, etc.) — different
-- leagues, and different sports within the same league, count "a busy
-- week" differently.
--
-- max_games_per_week is nullable: null means no cap (today's behavior,
-- unchanged). week_start_day is 0=Sunday..6=Saturday, matching
-- JS Date.getDay() and the day_of_week convention already used by
-- blackouts (0017) and day_slots (0019) — defaults to 0 (Sunday) so
-- existing rows behave like a standard Sun-Sat week if this is ever read
-- before a division has explicitly set it.

alter table schedule_generation_settings
  add column max_games_per_week int,
  add column week_start_day int not null default 0
    constraint schedule_generation_settings_week_start_day_check
    check (week_start_day between 0 and 6);

comment on column schedule_generation_settings.max_games_per_week is
  'Optional per-team cap on games within one calendar week for this division''s auto-generated schedule. Null = no cap.';
comment on column schedule_generation_settings.week_start_day is
  'Which weekday (0=Sunday..6=Saturday) starts the calendar week used to enforce max_games_per_week.';
