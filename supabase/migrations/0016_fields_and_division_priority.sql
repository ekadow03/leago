-- 0016_fields_and_division_priority.sql
--
-- Two additions for cross-division field-sharing:
--
-- 1. `fields` — an organization-level registry of physical field/court
--    names. Until now, each division's Season Builder screen let the
--    admin free-type field names into its own local list, with nothing
--    shared between divisions. generateSeasonSchedule() already checks
--    the whole organization's existing events for a conflicting
--    location+start_time — but that check is a literal string match, so
--    "Field 1" typed for one division and "field 1" or "Field One" typed
--    for another silently defeats it. A shared, org-wide list (picked
--    from a dropdown instead of retyped per division) is what makes that
--    conflict check actually reliable.
--
-- 2. `divisions.schedule_priority` — an admin-set ranking (lower number =
--    higher priority, generate first) for which division should get
--    first claim on a shared field/time slot. generateSeasonSchedule()
--    still works on a first-generated-claims-it basis — this column is
--    advisory: it lets the season manager show/sort divisions in the
--    order they should be generated, rather than automatically bumping
--    or deleting another division's already-created games, which would
--    be destructive if that schedule were already published.

create table fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

comment on table fields is
  'Organization-level registry of physical field/court names, shared across every season and division so the Season Builder field picker stays consistent enough for generateSeasonSchedule()''s cross-division conflict check to actually catch collisions.';

create index fields_org_idx on fields(organization_id);

alter table fields enable row level security;

create policy "org members can read fields"
  on fields for select
  using (is_org_member(organization_id) or is_platform_admin());

create policy "org admins can manage fields"
  on fields for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());

alter table divisions add column schedule_priority int not null default 0;

comment on column divisions.schedule_priority is
  'Admin-set ranking for which division should get first claim on a shared field/time slot when generating schedules — lower number generates first. An ordering signal for the season manager UI; generateSeasonSchedule() itself still resolves conflicts on a first-generated-claims-it basis and does not read this column.';
