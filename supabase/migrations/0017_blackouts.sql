-- 0017_blackouts.sql
--
-- Blocks generateSeasonSchedule() from placing games during dates/times a
-- field (or every field) isn't actually available — a holiday, a field
-- closure, a standing weekly conflict with another activity, etc.
--
-- Three recurrence "kinds", covering what was asked for:
--   'date'   — one specific calendar date (blackout_date). With no
--              start/end time, blocks the WHOLE day (the "holiday" case).
--              With a time range, blocks just that window on that date.
--   'weekly' — a given day of week (day_of_week, 0=Sun..6=Sat), recurring
--              for every occurrence of that weekday across the season.
--              With no time range, that whole weekday is blocked all
--              season; with one, just that window on that weekday.
--   'daily'  — every single day of the season. Only meaningful with a
--              time range set (a full-day 'daily' blackout would just
--              block scheduling entirely, which is what deactivating the
--              row is for) but not force-required, for consistency with
--              the other two kinds.
--
-- field_name is optional and matches the `fields` registry (migration
-- 0016) by name — null means the blackout applies to every field.
--
-- Scoped to season_id (not division_id): a blackout like "Thanksgiving,
-- no games" or "Field 2 closed for maintenance" should apply to every
-- division sharing that season, not need re-entering per division.

create table blackouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  field_name text,
  kind text not null check (kind in ('date', 'weekly', 'daily')),
  blackout_date date,
  day_of_week int check (day_of_week between 0 and 6),
  start_time time,
  end_time time,
  label text,
  created_at timestamptz not null default now(),
  constraint blackouts_date_required check (kind <> 'date' or blackout_date is not null),
  constraint blackouts_weekly_day_required check (kind <> 'weekly' or day_of_week is not null),
  constraint blackouts_time_range_pair check ((start_time is null) = (end_time is null))
);

comment on table blackouts is
  'Dates/times a field (or every field) is unavailable for schedule generation — see generateSeasonSchedule(), which fetches a season''s blackouts and skips any slot they cover. Not enforced at the database level beyond storage; generateSeasonSchedule() is the only writer of events that reads this table today.';

create index blackouts_season_idx on blackouts(season_id);
create index blackouts_org_idx on blackouts(organization_id);

alter table blackouts enable row level security;

create policy "org members can read blackouts"
  on blackouts for select
  using (is_org_member(organization_id) or is_platform_admin());

create policy "org admins can manage blackouts"
  on blackouts for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());
