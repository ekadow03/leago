-- ============================================================================
-- TEAM STAFF — multiple coaches/volunteers per team
-- ============================================================================
-- teams.coach_person_id was declared back in 0001_foundation.sql but
-- never actually written anywhere in the app (grep confirms only reads
-- of a value nothing ever set) — this replaces it with a proper table
-- supporting a head coach, any number of assistant coaches, and other
-- team volunteers, which is also what the coach-schedule-conflict check
-- below needs to know who coaches which team.

create table team_staff (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  role text not null check (role in ('head_coach', 'assistant_coach', 'volunteer')),
  created_at timestamptz not null default now(),
  unique (team_id, person_id)
);

comment on table team_staff is
  'Coaches and other volunteers attached to a specific team roster.
  Replaces the never-used teams.coach_person_id column. A person holds
  only one role per team (unique team_id+person_id) — change their role
  by removing and re-adding them.';

create index team_staff_team_idx on team_staff(team_id);
create index team_staff_person_idx on team_staff(person_id);

alter table team_staff enable row level security;

create policy "org members can read team staff"
  on team_staff for select
  using (
    exists (
      select 1 from teams t
      join divisions d on d.id = t.division_id
      join seasons s on s.id = d.season_id
      where t.id = team_staff.team_id
        and (is_org_member(s.organization_id) or is_platform_admin())
    )
  );

create policy "org admins can manage team staff"
  on team_staff for all
  using (
    exists (
      select 1 from teams t
      join divisions d on d.id = t.division_id
      join seasons s on s.id = d.season_id
      where t.id = team_staff.team_id
        and (is_org_admin(s.organization_id) or has_org_permission(s.organization_id, 'manage_divisions') or is_platform_admin())
    )
  )
  with check (
    exists (
      select 1 from teams t
      join divisions d on d.id = t.division_id
      join seasons s on s.id = d.season_id
      where t.id = team_staff.team_id
        and (is_org_admin(s.organization_id) or has_org_permission(s.organization_id, 'manage_divisions') or is_platform_admin())
    )
  );

-- Backfill from the legacy column (in practice always empty — nothing in
-- the app ever wrote to it — but safe to run regardless) before dropping it.
insert into team_staff (team_id, person_id, role)
select id, coach_person_id, 'head_coach'
from teams
where coach_person_id is not null
on conflict (team_id, person_id) do nothing;

alter table teams drop column coach_person_id;
