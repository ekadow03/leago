-- seed_test_league.sql
-- Run this in the Supabase SQL Editor (not via `db push` — this is data,
-- not schema) to create one test organization with an open season and a
-- couple of priced divisions, so there's something to actually register for.
--
-- NOTE: this org has no stripe_connect_account_id yet — createRegistration()
-- requires one (it throws "This organization has not completed payment
-- setup" otherwise). After running this, call startStripeConnectOnboarding
-- for this org's id and complete Stripe's test-mode onboarding before
-- testing a real registration payment.

insert into organizations (name, slug, subscription_tier, subscription_status)
values ('Test Rec Baseball League', 'test-rec-baseball', 'trial', 'trialing')
returning id;
-- ^ copy the returned id — you'll need it for the next two inserts.
-- Replace <ORG_ID> below with that value.

insert into seasons (organization_id, name, status, registration_open_at, registration_close_at)
values ('<ORG_ID>', 'Fall 2026 Season', 'registration_open', now(), now() + interval '60 days')
returning id;
-- ^ copy this returned id too — replace <SEASON_ID> below.

insert into divisions (season_id, name, age_min, age_max, price_cents)
values
  ('<SEASON_ID>', '6U Coach Pitch', 4, 6, 12000),
  ('<SEASON_ID>', '8U Player Pitch', 7, 8, 15000),
  ('<SEASON_ID>', '10U', 9, 10, 15000);

-- Verify:
select o.name as org, s.name as season, d.name as division, d.price_cents
from organizations o
join seasons s on s.organization_id = o.id
join divisions d on d.season_id = s.id
where o.slug = 'test-rec-baseball';
