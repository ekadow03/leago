-- 0001_foundation.sql
-- Phase 1: multi-tenant foundation — organizations, people, membership,
-- seasons/divisions/teams skeleton. RLS enabled and policies defined for
-- every table. No compliance/draft/tournament tables yet — later phases.

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================================
-- ORGANIZATIONS  (tenants)
-- ============================================================================
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  subdomain text unique,
  custom_domain text unique,
  branding_theme jsonb not null default '{}'::jsonb, -- colors, logo url, etc
  stripe_connect_account_id text,
  subscription_tier text not null default 'trial'
    check (subscription_tier in ('trial', 'starter', 'growth', 'enterprise')),
  subscription_status text not null default 'trialing'
    check (subscription_status in ('trialing', 'active', 'past_due', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table organizations is 'Top-level tenant. Every league is one row here.';

-- ============================================================================
-- PEOPLE  (not scoped to a single org — a coach/player can belong to many)
-- ============================================================================
create table people (
  id uuid primary key default gen_random_uuid(),
  -- nullable: a person row can exist before they have platform login
  -- (e.g. a child registrant, or someone invited but not yet signed up)
  auth_user_id uuid references auth.users(id) on delete set null unique,
  first_name text not null,
  last_name text not null,
  dob date, -- nullable at creation; required before registration completes
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table people is
  'A human. Not scoped to one org — mirrors real life (a coach can carry '
  'their verified status across leagues). Org relationship lives in '
  'organization_members.';

create index people_auth_user_id_idx on people(auth_user_id);
create index people_email_idx on people(email);

-- ============================================================================
-- ORGANIZATION_MEMBERS  (the actual multi-tenant join)
-- ============================================================================
create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  role text not null check (role in ('player', 'parent', 'coach', 'volunteer', 'admin')),
  -- for players/parents: which parent(s) manage this player's account
  guardian_of uuid references people(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (organization_id, person_id, role)
);

comment on table organization_members is
  'Join table: which orgs a person belongs to, and in what role(s). A person '
  'can have multiple rows for the same org (e.g. parent AND coach).';

create index org_members_org_idx on organization_members(organization_id);
create index org_members_person_idx on organization_members(person_id);

-- ============================================================================
-- SEASONS
-- ============================================================================
create table seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  registration_open_at timestamptz,
  registration_close_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'registration_open', 'registration_closed', 'active', 'completed', 'archived')),
  created_at timestamptz not null default now()
);

create index seasons_org_idx on seasons(organization_id);

-- ============================================================================
-- DIVISIONS
-- ============================================================================
create table divisions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  name text not null,
  age_min int,
  age_max int,
  skill_level text,
  created_at timestamptz not null default now()
);

create index divisions_season_idx on divisions(season_id);

-- ============================================================================
-- TEAMS
-- ============================================================================
create table teams (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references divisions(id) on delete cascade,
  name text not null,
  coach_person_id uuid references people(id) on delete set null,
  created_at timestamptz not null default now()
);

create index teams_division_idx on teams(division_id);

-- ============================================================================
-- updated_at triggers
-- ============================================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_updated_at
  before update on organizations
  for each row execute function set_updated_at();

create trigger people_updated_at
  before update on people
  for each row execute function set_updated_at();

-- ============================================================================
-- HELPER FUNCTIONS  (used by RLS policies — defined once, reused everywhere)
-- ============================================================================

-- Is the current auth user an active member of this org, in ANY role?
create or replace function is_org_member(org_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from organization_members om
    join people p on p.id = om.person_id
    where om.organization_id = org_id
      and p.auth_user_id = auth.uid()
      and om.status = 'active'
  );
$$;

-- Is the current auth user an admin of this org?
create or replace function is_org_admin(org_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from organization_members om
    join people p on p.id = om.person_id
    where om.organization_id = org_id
      and p.auth_user_id = auth.uid()
      and om.role = 'admin'
      and om.status = 'active'
  );
$$;

-- Platform-level super admin (you) — checked via a claim on the JWT, set
-- manually for your own account. Not exposed to league admins.
create or replace function is_platform_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'platform_admin')::boolean,
    false
  );
$$;

comment on function is_platform_admin() is
  'True only for Anthropic/platform-owner accounts with app_metadata.platform_admin '
  '= true set via the Supabase admin API. Never settable by the user themselves.';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table organizations enable row level security;
alter table people enable row level security;
alter table organization_members enable row level security;
alter table seasons enable row level security;
alter table divisions enable row level security;
alter table teams enable row level security;

-- ---- organizations ----
create policy "org members can read their org"
  on organizations for select
  using (is_org_member(id) or is_platform_admin());

create policy "org admins can update their org"
  on organizations for update
  using (is_org_admin(id) or is_platform_admin());

create policy "platform admin can insert orgs"
  on organizations for insert
  with check (is_platform_admin());
  -- org creation happens via a platform-controlled signup flow (Server Action
  -- using service role), not direct client inserts — see lib/organizations.ts

-- ---- people ----
-- A person can always read/update their own row.
create policy "people can read own row"
  on people for select
  using (auth_user_id = auth.uid());

create policy "people can update own row"
  on people for update
  using (auth_user_id = auth.uid());

-- Org admins can read/update people who are members of their org.
create policy "org admins can read member people"
  on people for select
  using (
    exists (
      select 1 from organization_members om
      where om.person_id = people.id
        and is_org_admin(om.organization_id)
    )
    or is_platform_admin()
  );

create policy "org admins can update member people"
  on people for update
  using (
    exists (
      select 1 from organization_members om
      where om.person_id = people.id
        and is_org_admin(om.organization_id)
    )
    or is_platform_admin()
  );

-- ---- organization_members ----
create policy "org members can read their org's membership list"
  on organization_members for select
  using (is_org_member(organization_id) or is_platform_admin());

create policy "org admins can manage membership"
  on organization_members for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());

-- ---- seasons / divisions / teams ----
-- Public read for published data (registrants/public need to see schedules
-- without being an authenticated org member) — refine "published" gating
-- in a later migration once seasons have a public visibility flag.
create policy "org members can read seasons"
  on seasons for select
  using (is_org_member(organization_id) or is_platform_admin());

create policy "org admins can manage seasons"
  on seasons for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());

create policy "org members can read divisions"
  on divisions for select
  using (
    exists (select 1 from seasons s where s.id = divisions.season_id and is_org_member(s.organization_id))
    or is_platform_admin()
  );

create policy "org admins can manage divisions"
  on divisions for all
  using (
    exists (select 1 from seasons s where s.id = divisions.season_id and is_org_admin(s.organization_id))
    or is_platform_admin()
  )
  with check (
    exists (select 1 from seasons s where s.id = divisions.season_id and is_org_admin(s.organization_id))
    or is_platform_admin()
  );

create policy "org members can read teams"
  on teams for select
  using (
    exists (
      select 1 from divisions d
      join seasons s on s.id = d.season_id
      where d.id = teams.division_id and is_org_member(s.organization_id)
    )
    or is_platform_admin()
  );

create policy "org admins can manage teams"
  on teams for all
  using (
    exists (
      select 1 from divisions d
      join seasons s on s.id = d.season_id
      where d.id = teams.division_id and is_org_admin(s.organization_id)
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from divisions d
      join seasons s on s.id = d.season_id
      where d.id = teams.division_id and is_org_admin(s.organization_id)
    )
    or is_platform_admin()
  );
