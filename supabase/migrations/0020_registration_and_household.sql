-- 0020_registration_and_household.sql
-- Player registration build-out: household/guardian linking (so a parent
-- can register a child who has no login of their own), a season-wide age
-- eligibility cutoff, and a per-season configurable set of registration
-- fields (waiver, birth certificate, jersey/hat size, jersey number,
-- years experience) — the "sports connect / sports engine"-style toggle
-- set from Evan's request, kept as explicit typed columns rather than a
-- generic JSON blob so the DB enforces shape and the admin UI stays simple.

-- ============================================================================
-- SEASONS: age-cutoff date
-- ============================================================================
-- Youth sports eligibility model chosen: ONE cutoff date per season
-- (e.g. "age as of 8/1/2026"), compared against each division's existing
-- age_min/age_max (int) range — not a per-division exact birth-date
-- range. Nullable: a season with no cutoff set just skips age gating.
alter table seasons add column age_cutoff_date date;

comment on column seasons.age_cutoff_date is
  'The date used to compute a registrant''s age for division eligibility '
  '(age_min/age_max on divisions). Null means this season does not '
  'age-gate registration.';

-- ============================================================================
-- GUARDIANS  (household linking — decoupled from any org)
-- ============================================================================
-- Deliberately NOT reusing organization_members.guardian_of: that column
-- requires an organization_members row to already exist, which itself
-- requires an org — but a parent needs to be able to add a child to their
-- household from their own dashboard before picking any league to
-- register with. people is already a global (non-org-scoped) table, so
-- this relationship is too.
create table guardians (
  id uuid primary key default gen_random_uuid(),
  guardian_person_id uuid not null references people(id) on delete cascade,
  dependent_person_id uuid not null references people(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (guardian_person_id, dependent_person_id),
  check (guardian_person_id <> dependent_person_id)
);

comment on table guardians is
  'A parent/guardian person managing a dependent (typically a minor child '
  'with no auth_user_id of their own) — lets one logged-in account see and '
  'register multiple household members from their dashboard.';

create index guardians_guardian_idx on guardians(guardian_person_id);
create index guardians_dependent_idx on guardians(dependent_person_id);

-- ============================================================================
-- REGISTRATION_SETTINGS  (season-scoped, fixed toggleable field set)
-- ============================================================================
create table registration_settings (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade unique,

  require_waiver boolean not null default false,
  waiver_text text,

  require_birth_certificate boolean not null default false,

  offer_jersey_size boolean not null default false,
  jersey_sizes text[] not null default '{}',

  offer_hat_size boolean not null default false,
  hat_sizes text[] not null default '{}',

  offer_jersey_number boolean not null default false,
  offer_years_experience boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table registration_settings is
  'One row per season, configured by the org admin, driving which optional '
  'fields the front-end registration form shows/requires. Fixed set of '
  'fields (not a generic form builder) per Evan''s chosen scope.';

create index registration_settings_season_idx on registration_settings(season_id);

create trigger registration_settings_updated_at
  before update on registration_settings
  for each row execute function set_updated_at();

-- ============================================================================
-- REGISTRATIONS: new response columns for the optional fields above
-- ============================================================================
alter table registrations
  add column waiver_signed_name text,
  add column waiver_signed_at timestamptz,
  add column birth_certificate_path text,
  add column jersey_size text,
  add column hat_size text,
  add column jersey_number text,
  add column years_experience int;

comment on column registrations.birth_certificate_path is
  'Storage path in the compliance-documents bucket, set when this season''s '
  'registration_settings.require_birth_certificate is true. Intentionally '
  'separate from the documents/compliance_records tables used by the '
  'existing admin compliance-review flow (that system is self-only today, '
  'no guardian/child support) — a future pass may unify them.';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table guardians enable row level security;
alter table registration_settings enable row level security;

-- ---- guardians ----
create policy "guardians can manage own relationships"
  on guardians for all
  using (
    exists (select 1 from people p where p.id = guardians.guardian_person_id and p.auth_user_id = auth.uid())
    or is_platform_admin()
  )
  with check (
    exists (select 1 from people p where p.id = guardians.guardian_person_id and p.auth_user_id = auth.uid())
    or is_platform_admin()
  );

-- ---- registration_settings ----
create policy "public can read registration settings of open seasons"
  on registration_settings for select
  using (
    exists (
      select 1 from seasons s
      where s.id = registration_settings.season_id and s.status = 'registration_open'
    )
  );

create policy "org members can read registration settings"
  on registration_settings for select
  using (
    exists (select 1 from seasons s where s.id = registration_settings.season_id and is_org_member(s.organization_id))
    or is_platform_admin()
  );

create policy "org admins can manage registration settings"
  on registration_settings for all
  using (
    exists (select 1 from seasons s where s.id = registration_settings.season_id and is_org_admin(s.organization_id))
    or is_platform_admin()
  )
  with check (
    exists (select 1 from seasons s where s.id = registration_settings.season_id and is_org_admin(s.organization_id))
    or is_platform_admin()
  );

-- ============================================================================
-- ROW LEVEL SECURITY — people: guardians can see/update their dependents
-- ============================================================================
create policy "guardians can read dependent people rows"
  on people for select
  using (
    exists (
      select 1 from guardians g
      join people gp on gp.id = g.guardian_person_id
      where g.dependent_person_id = people.id and gp.auth_user_id = auth.uid()
    )
  );

create policy "guardians can update dependent people rows"
  on people for update
  using (
    exists (
      select 1 from guardians g
      join people gp on gp.id = g.guardian_person_id
      where g.dependent_person_id = people.id and gp.auth_user_id = auth.uid()
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY — storage.objects for birth certificates uploaded
-- during registration (reuses the existing private compliance-documents
-- bucket from 0006_compliance.sql — no new bucket needed)
-- ============================================================================
create policy "guardians can read own uploaded registration files"
  on storage.objects for select
  using (
    bucket_id = 'compliance-documents'
    and exists (
      select 1 from registrations r
      join people p on p.id = r.person_id
      where r.birth_certificate_path = storage.objects.name
        and p.auth_user_id = auth.uid()
    )
  );

create policy "submitters can read files they uploaded for a dependent"
  on storage.objects for select
  using (
    bucket_id = 'compliance-documents'
    and exists (
      select 1 from registrations r
      join people p on p.id = r.submitted_by_person_id
      where r.birth_certificate_path = storage.objects.name
        and p.auth_user_id = auth.uid()
    )
  );

create policy "org admins can read registration files"
  on storage.objects for select
  using (
    bucket_id = 'compliance-documents'
    and exists (
      select 1 from registrations r
      where r.birth_certificate_path = storage.objects.name
        and is_org_admin(r.organization_id)
    )
  );
