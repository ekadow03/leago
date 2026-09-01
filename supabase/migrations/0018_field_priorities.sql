-- 0018_field_priorities.sql
--
-- Real, enforced per-field priority ranking between divisions that share
-- a field — a follow-on to migration 0016's `fields` registry and
-- `divisions.schedule_priority` (which was explicitly advisory-only; see
-- that migration's comment). This table is read by
-- generateSeasonSchedule() itself.
--
-- One row = "this division has this rank (1 = highest) among the
-- divisions competing for this field." Priorities are scoped to a single
-- field — a division can be priority 1 on Field 1 and priority 3 on
-- Field 2 at the same time, since it's a measure of standing relative to
-- the OTHER divisions sharing that specific field, not a global ranking.
--
-- Two equivalent ways to edit this same data in the UI:
--   - From a field (Fields panel): pick a field, see/reorder the
--     divisions competing for it.
--   - From a division (Season Manager division row): pick fields for
--     that division; the first one picked becomes priority 1 if the
--     field has no other claimants yet, otherwise it's appended after
--     whichever divisions already rank there (the admin can always edit
--     the number directly on either screen to override).
--
-- generateSeasonSchedule() behavior (see that file for the exact check):
-- when a division without top billing on a field generates its
-- schedule, any field where a HIGHER-priority division exists that has
-- not yet been scheduled there (zero events on that field, org-wide) is
-- treated as reserved and skipped for this run. Once the higher-priority
-- division has at least one game on that field, the reservation lifts.
-- If priorities were never set up for a field, nothing changes from the
-- prior first-generated-claims-it behavior.

create table field_priorities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  field_id uuid not null references fields(id) on delete cascade,
  division_id uuid not null references divisions(id) on delete cascade,
  priority int not null default 1,
  created_at timestamptz not null default now(),
  unique (field_id, division_id)
);

comment on table field_priorities is
  'Per-field ranking of which division has first claim when divisions share a field — read by generateSeasonSchedule() to reserve a field for a higher-priority division until it has been scheduled there. See migration comment for the full behavior.';

create index field_priorities_org_idx on field_priorities(organization_id);
create index field_priorities_field_idx on field_priorities(field_id);
create index field_priorities_division_idx on field_priorities(division_id);

alter table field_priorities enable row level security;

create policy "org members can read field priorities"
  on field_priorities for select
  using (is_org_member(organization_id) or is_platform_admin());

create policy "org admins can manage field priorities"
  on field_priorities for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());
