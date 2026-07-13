-- 0012_platform_subscriptions.sql
-- Phase 8: platform billing (ARCHITECTURE.md §9) — leagues paying the
-- platform owner (not Stripe Connect; this is Stripe Billing, a separate
-- Stripe object graph entirely, matching the "deliberate deviation" flagged
-- back in ARCHITECTURE.md §9).

alter table organizations add column stripe_customer_id text;

comment on column organizations.stripe_customer_id is
  'Stripe Customer for platform subscription billing — distinct from
  stripe_connect_account_id, which is for receiving registration payments.
  These are two unrelated Stripe object graphs on the same org row.';

create table platform_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  stripe_subscription_id text not null unique,
  tier text not null check (tier in ('starter', 'growth', 'enterprise')),
  status text not null check (status in ('active', 'past_due', 'canceled', 'incomplete')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table platform_subscriptions is
  'Mirrors Stripe subscription state locally so the app can gate features
  without calling the Stripe API on every request. Kept in sync via webhook
  events (checkout.session.completed, customer.subscription.updated/deleted)
  — see app/api/webhooks/stripe/route.ts.';

create index platform_subscriptions_org_idx on platform_subscriptions(organization_id);

create trigger platform_subscriptions_updated_at
  before update on platform_subscriptions
  for each row execute function set_updated_at();

alter table platform_subscriptions enable row level security;

create policy "org admins can read their own subscription"
  on platform_subscriptions for select
  using (is_org_admin(organization_id) or is_platform_admin());