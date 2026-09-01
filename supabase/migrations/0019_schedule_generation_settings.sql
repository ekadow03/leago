-- 0019_schedule_generation_settings.sql
--
-- Remembers the last set of inputs used to generate a division's
-- schedule (day/time/field slots, games per team, game duration, date
-- range) so the Season Builder screen can restore them instead of
-- starting blank every visit, and so "Generate" can mean "regenerate
-- from scratch with today's teams/blackouts/priorities" without losing
-- what was configured last time.
--
-- One row per division (division_id is unique) — generateSeasonSchedule()
-- upserts it after every successful run. day_slots stores the exact flat
-- {dayOfWeek, time, field}[] list the generator itself was called with;
-- the Season Builder UI regroups that back into its per-day/per-time
-- picker state on load, so no separate UI-shaped copy is needed.
--
-- Not itself read by generateSeasonSchedule() for anything other than
-- being written to — regenerating always uses whatever slots/dates are
-- currently in the form (which start out equal to this saved row, but
-- can be edited before regenerating).

create table schedule_generation_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  division_id uuid not null references divisions(id) on delete cascade,
  day_slots jsonb not null default '[]'::jsonb,
  games_per_team int not null,
  game_duration_minutes int not null,
  start_date date not null,
  end_date date not null,
  updated_at timestamptz not null default now(),
  unique (division_id)
);

comment on table schedule_generation_settings is
  'Last-used inputs to generateSeasonSchedule() for a division, restored into the Season Builder form on load so regenerating with updated teams/blackouts/priorities doesn''t require re-entering everything.';

create index schedule_generation_settings_org_idx on schedule_generation_settings(organization_id);

alter table schedule_generation_settings enable row level security;

create policy "org members can read schedule generation settings"
  on schedule_generation_settings for select
  using (is_org_member(organization_id) or is_platform_admin());

create policy "org admins can manage schedule generation settings"
  on schedule_generation_settings for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());
