-- 0004_division_pricing.sql
-- Registration needs a price to charge. Pricing by division (age
-- group/skill level) matches how youth sports leagues actually price
-- registration — e.g. "6U" might be $120, "12U" might be $180.
--
-- Note: registrations.division_id was designed to stay null until the
-- draft assigns a team (see 0002_registrations.sql comment). This still
-- holds for TEAM assignment. But the registrant DOES pick a division at
-- signup time for pricing/age-bracket purposes — think of it as "intended
-- division," which the draft may adjust. Not a contradiction, just two
-- different meanings worth keeping straight when building the draft tool
-- later: division_id at registration time = pricing/eligibility bracket;
-- division_id after draft = confirmed placement (same column, values may
-- coincide but the second write is authoritative).

alter table divisions add column price_cents int not null default 0;

comment on column divisions.price_cents is
  'Registration price for this division, in cents. 0 is a valid value '
  '(e.g. a free volunteer-only division) — do not treat 0 as "unset."';
