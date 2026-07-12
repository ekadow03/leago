-- 0002_registrations.sql
-- Phase 2: registrations + payment tracking. Stripe Connect account already
-- lives on organizations.stripe_connect_account_id (0001_foundation.sql).
-- This migration does NOT touch that table — only adds registrations.

-- ============================================================================
-- REGISTRATIONS
-- ============================================================================
create table registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade, -- the registrant (player/coach/volunteer)
  division_id uuid references divisions(id) on delete set null, -- null until team formation/draft assigns one
  team_id uuid references teams(id) on delete set null,

  registration_type text not null
    check (registration_type in ('player', 'coach', 'volunteer')),

  -- who submitted this registration, if not the registrant themselves
  -- (e.g. a parent registering a minor child)
  submitted_by_person_id uuid references people(id) on delete set null,

  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'waitlisted', 'canceled')),

  -- payment
  amount_cents int not null default 0,
  currency text not null default 'usd',
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'processing', 'paid', 'refunded', 'partially_refunded', 'failed')),
  stripe_payment_intent_id text,

  -- refunds — one registration can have partial refunds, so track cumulative
  refunded_amount_cents int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- a person shouldn't have two active registrations of the same type
  -- for the same season (re-registering after a cancel is fine — that's
  -- a new row, since the old one stays as historical record)
  unique (person_id, season_id, registration_type, status)
    -- NOTE: this unique constraint including `status` means a canceled +
    -- a pending registration for the same person/season/type CAN coexist,
    -- which is intentional (keeps cancellation history rather than deleting).
    -- Application logic must still check for an existing *pending/confirmed*
    -- registration before creating a new one to prevent accidental duplicates.
);

comment on table registrations is
  'One row per registration attempt. Historical — canceled registrations are '
  'never deleted, only status-flipped, so past-season data stays queryable '
  'per Evan''s requirement to retain historical registration data.';

create index registrations_org_idx on registrations(organization_id);
create index registrations_season_idx on registrations(season_id);
create index registrations_person_idx on registrations(person_id);
create index registrations_payment_intent_idx on registrations(stripe_payment_intent_id);

create trigger registrations_updated_at
  before update on registrations
  for each row execute function set_updated_at();

-- ============================================================================
-- REFUNDS  (audit trail — separate from the cumulative counter on registrations)
-- ============================================================================
create table refunds (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  amount_cents int not null,
  reason text,
  stripe_refund_id text not null,
  initiated_by_person_id uuid references people(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table refunds is
  'Audit log of individual refund events. registrations.refunded_amount_cents '
  'is the running total; this table is the detail behind it — needed if a '
  'league ever has to explain "why was this refunded" to a parent or auditor.';

create index refunds_registration_idx on refunds(registration_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table registrations enable row level security;
alter table refunds enable row level security;

-- ---- registrations ----
-- A person can read their own registrations, and registrations they submitted
-- on behalf of someone else (e.g. parent viewing their kid's registration).
create policy "people can read own or submitted registrations"
  on registrations for select
  using (
    exists (select 1 from people p where p.id = registrations.person_id and p.auth_user_id = auth.uid())
    or exists (select 1 from people p where p.id = registrations.submitted_by_person_id and p.auth_user_id = auth.uid())
    or is_org_admin(organization_id)
    or is_platform_admin()
  );

-- Only org admins can directly mutate registrations via the client (normal
-- creation flow goes through a Server Action using the service-role client
-- so the Stripe PaymentIntent and the row are created atomically — see
-- lib/actions/registrations.ts). This policy covers admin-side edits
-- (marking confirmed, manual status changes, refund status corrections).
create policy "org admins can manage registrations"
  on registrations for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());

-- ---- refunds ----
create policy "people can read refunds on their own registrations"
  on refunds for select
  using (
    exists (
      select 1 from registrations r
      join people p on p.id = r.person_id
      where r.id = refunds.registration_id and p.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from registrations r
      where r.id = refunds.registration_id and is_org_admin(r.organization_id)
    )
    or is_platform_admin()
  );

create policy "org admins can manage refunds"
  on refunds for all
  using (
    exists (
      select 1 from registrations r
      where r.id = refunds.registration_id and is_org_admin(r.organization_id)
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from registrations r
      where r.id = refunds.registration_id and is_org_admin(r.organization_id)
    )
    or is_platform_admin()
  );
