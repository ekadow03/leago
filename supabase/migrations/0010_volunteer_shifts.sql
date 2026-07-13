-- 0010_volunteer_shifts.sql
-- Phase 6: league hub, volunteer sign-up slice (ARCHITECTURE.md §11).
-- A shift belongs to an event (e.g. "Concession stand" tied to a game, or
-- a standalone event of type volunteer_shift). Signups are a separate
-- table so we can enforce capacity and let people cancel cleanly.

create table volunteer_shifts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  role text not null,
  slots_total int not null check (slots_total > 0),
  notes text,
  created_at timestamptz not null default now()
);

comment on table volunteer_shifts is
  'A volunteer role/slot tied to an event. slots_filled is NOT stored here —
  derived from counting volunteer_signups, so it can never drift out of
  sync with the actual signups.';

create index volunteer_shifts_event_idx on volunteer_shifts(event_id);

create table volunteer_signups (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references volunteer_shifts(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  signed_up_at timestamptz not null default now(),
  unique (shift_id, person_id)
);

comment on table volunteer_signups is
  'One row per person per shift they''ve claimed. Capacity (slots_total)
  is enforced in the Server Action, not by a DB constraint, since Postgres
  check constraints can''t reference aggregate counts across rows.';

create index volunteer_signups_shift_idx on volunteer_signups(shift_id);
create index volunteer_signups_person_idx on volunteer_signups(person_id);

alter table volunteer_shifts enable row level security;
alter table volunteer_signups enable row level security;

create policy "public can read shifts on published events"
  on volunteer_shifts for select
  using (
    exists (
      select 1 from events e
      where e.id = volunteer_shifts.event_id and e.status = 'published'
    )
  );

create policy "org members can read all shifts"
  on volunteer_shifts for select
  using (
    exists (
      select 1 from events e
      where e.id = volunteer_shifts.event_id and is_org_member(e.organization_id)
    )
    or is_platform_admin()
  );

create policy "org admins can manage shifts"
  on volunteer_shifts for all
  using (
    exists (
      select 1 from events e
      where e.id = volunteer_shifts.event_id and is_org_admin(e.organization_id)
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from events e
      where e.id = volunteer_shifts.event_id and is_org_admin(e.organization_id)
    )
    or is_platform_admin()
  );

create policy "org members can read signups"
  on volunteer_signups for select
  using (
    exists (
      select 1 from volunteer_shifts vs
      join events e on e.id = vs.event_id
      where vs.id = volunteer_signups.shift_id and is_org_member(e.organization_id)
    )
    or is_platform_admin()
  );

create policy "people can cancel their own signup"
  on volunteer_signups for delete
  using (
    exists (select 1 from people p where p.id = volunteer_signups.person_id and p.auth_user_id = auth.uid())
    or exists (
      select 1 from volunteer_shifts vs
      join events e on e.id = vs.event_id
      where vs.id = volunteer_signups.shift_id and is_org_admin(e.organization_id)
    )
    or is_platform_admin()
  );