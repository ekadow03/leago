-- 0009_events_and_schedule.sql
-- Phase 5: season scheduling + public publishing (ARCHITECTURE.md §11
-- build order). One table covers games, practices, and general league
-- events — differentiated by `type`. Draft/published status lets admins
-- build a schedule privately before making it visible to registrants.

create table events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid references seasons(id) on delete cascade,
  division_id uuid references divisions(id) on delete cascade,
  type text not null check (type in ('game', 'practice', 'volunteer_shift', 'league_event')),
  title text not null,
  location text,
  start_time timestamptz not null,
  end_time timestamptz,
  home_team_id uuid references teams(id) on delete set null,
  away_team_id uuid references teams(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'published', 'canceled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table events is
  'Games, practices, and general league events. status=draft lets admins
  build the schedule before publishing — mirrors the pattern already used
  for seasons.status=registration_open in 0003_public_registration_visibility.sql.';

create index events_org_idx on events(organization_id);
create index events_season_idx on events(season_id);
create index events_start_time_idx on events(start_time);

create trigger events_updated_at
  before update on events
  for each row execute function set_updated_at();

alter table events enable row level security;

create policy "public can read published events"
  on events for select
  using (status = 'published');

create policy "org members can read all events"
  on events for select
  using (is_org_member(organization_id) or is_platform_admin());

create policy "org admins can manage events"
  on events for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());