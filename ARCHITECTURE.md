# League Platform — Architecture & Planning Doc

*A multi-tenant SaaS for youth/rec sports leagues — registration, compliance, team
formation, scheduling, volunteer management, and tournament hosting.
Competitive positioning: SportsEngine / SportsConnect, but faster and better-designed.*

Status: **pre-build planning.** Nothing coded yet. This doc is the reference point for
every future session — treat it the way the Tap 2 Table migration history is treated.

---

## 1. Product scope (confirmed with Evan)

- Multi-tenant from day one — many leagues, each a fully isolated tenant
- Player + coach + volunteer registration, with payment (Stripe) and refunds
- Historical data retained across seasons (players, teams, registrations)
- Compliance: birth certificate verification, coach certifications, background checks
  via a **3rd-party verification service** (not built in-house)
- League hub: volunteer sign-up, events, general content — "one stop shop"
- **Team formation via live draft**: player evaluation day produces ratings →
  live draft tool → admin/league rep assigns players to teams in real time
- Season scheduling, published to public/registrants
- Tournament hosting module — outside orgs/teams register for one-off tournaments,
  separate from regular season membership
- Platform billing: leagues pay *you* a subscription to use the platform
- Design: fun, trendy — explicitly not evoking the dated feel of SportsEngine/SportsConnect

---

## 2. Recommended stack

Same family as Tap 2 Table, since it fits this problem well independent of familiarity:

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router, Server Actions) | Same reasoning as Tap 2 Table — good fit for form-heavy CRUD + admin dashboards |
| DB / Auth | Supabase (Postgres + RLS) | Row-level security is a near-perfect fit for tenant isolation — every table gets a `league_id` and RLS policies do the enforcement, not application code |
| Realtime | Supabase Realtime | Required for the live draft board (multi-user synced state) |
| Payments (registration) | Stripe Connect | Each league is a connected account; registration payments flow to the league, platform takes a fee |
| Payments (platform billing) | Stripe Billing (subscriptions) | Separate from Connect — this is leagues paying you |
| File storage | Supabase Storage | Birth certificates, coach cert uploads — private buckets, signed URLs only |
| Background checks | 3rd-party API (Sterling Volunteers or Ankored — see §5) | Never store raw background check results yourself beyond a status enum |
| Hosting | Vercel | Matches Tap 2 Table deploy pattern |

**One deliberate deviation from Tap 2 Table:** the live draft needs actual realtime
multi-client sync (draft board state, "on the clock," pick timer). Supabase Realtime
(Postgres changes + presence channels) handles this natively — plan the draft schema
around it from the start rather than retrofitting.

---

## 3. Multi-tenancy model

- `organizations` table = top-level tenant (a league). Everything else hangs off
  `organization_id`.
- `seasons` belong to an organization. `divisions` belong to a season. `teams` belong
  to a division within a season.
- A single **person** (player, parent, coach, volunteer) can belong to multiple
  organizations over time (e.g. plays rec ball for League A, travel ball hosted by
  League B's tournament). Model `people` somewhat independently of `organization_id`
  with a join table (`organization_members`), so historical cross-league data isn't
  artificially siloed at the person level — mirrors how Sterling's "shareable
  credential" model works for background checks (a vetted coach shouldn't have to
  re-verify per league).
- RLS policies enforce that org admins only see their org's data; platform-level
  "super admin" role (you) can see across all orgs for support/billing purposes.
- Custom branding per org: logo, color theme, subdomain (`orgname.yourplatform.com`)
  or custom domain — SportsEngine and SportsConnect both do this; it's expected.

---

## 4. Core data model (high level — not final schema)

```
organizations
  id, name, slug, subdomain, branding_theme, stripe_connect_account_id,
  subscription_tier, subscription_status

people
  id, first_name, last_name, dob, email, phone
  (dob is sensitive — see §6)

organization_members
  person_id, organization_id, role (player | parent | coach | volunteer | admin)

seasons
  id, organization_id, name, registration_open_at, registration_close_at, status

divisions
  id, season_id, name, age_min, age_max, skill_level

registrations
  id, person_id, season_id, division_id (nullable until draft), status,
  payment_status, stripe_payment_intent_id, refund_status

evaluations
  id, person_id, season_id, evaluator_id, scores (jsonb), notes

draft_sessions
  id, season_id, division_id, status (pending | live | complete), current_pick_index

draft_picks
  id, draft_session_id, pick_number, team_id, person_id, picked_at

teams
  id, division_id, name, coach_person_id

compliance_records
  id, person_id, type (background_check | coach_cert | birth_certificate),
  status (pending | submitted | verified | rejected | expired),
  external_reference_id (Sterling/Ankored's ID, not raw result data),
  verified_at, expires_at

documents
  id, person_id, type, storage_path (Supabase Storage, private bucket), uploaded_at

events
  id, organization_id, title, start_time, location, type (game | practice | volunteer_shift | league_event)

volunteer_shifts
  id, event_id, role, slots_total, slots_filled

tournaments
  id, organization_id (host), name, is_public_facing, registration_open

tournament_teams
  id, tournament_id, team_name, contact_person_id, is_external (bool — outside org or not)

platform_subscriptions
  id, organization_id, stripe_subscription_id, tier, status
```

This is a starting skeleton, not a migration file — expect real design passes once
build starts, same as Tap 2 Table's 0001→0023 evolution.

---

## 5. Compliance & background checks — vendor note

Researched two live options (as of July 2026):

- **Sterling Volunteers** (now part of First Advantage) — the incumbent in youth
  sports; used by Pop Warner, AYSO, YMCA, NCAA. Integration pattern is async:
  you submit a request with the volunteer's name/email/DOB/zip, Sterling emails
  them a link to complete their own profile + consent on Sterling's platform,
  then sends back a status (`Adjudicated-Eligible`, `Adjudicated-Ineligible`,
  `Complete-Clear`, `Complete-Consider`) via webhook/callback. You never handle
  raw criminal record data — just store the status + their reference ID. This
  is good: keeps you out of FCRA-adjacent liability for interpreting results.
- **Ankored** — newer, positions itself as a full youth-sports *compliance*
  platform rather than just a screening vendor (runs checks through NCSI/JDP/Yardstik
  as backend providers, plus tracks training/cert renewals and expirations). Already
  integrates with roster platforms like TeamSnap and LeagueApps, which suggests
  it's built to be the thing *you'd* integrate with rather than building your own
  Sterling integration from scratch.

**Recommendation:** don't build a direct Sterling integration first. Evaluate Ankored's
API/partner docs — if it does clearance tracking + expiration reminders + multi-provider
backend, it's less work than reimplementing that logic yourself against raw Sterling
webhooks. Confirm current API terms directly with either vendor before committing —
this space moves and neither vendor's public docs were designed for this kind of
reference lookup.

**Birth certificate verification** has no equivalent turnkey API — no vendor
verifies authenticity of a birth certificate image the way Sterling verifies a
background check. Realistic options: (a) manual admin review of uploaded document
against declared DOB — this is what SportsConnect/SportsEngine actually do, or
(b) a general-purpose ID-verification vendor (e.g. Persona, Stripe Identity) if the
league wants stronger fraud resistance. Plan for (a) at launch, leave room for (b) later.

---

## 6. Sensitive data handling

This platform touches more regulated categories than Tap 2 Table did — worth being
deliberate about from the start rather than retrofitting:

- **Minors' PII** (name, DOB, birth certificate images) — treat as high-sensitivity
  regardless of state law specifics; private storage buckets, signed URLs with short
  expiry, no minor PII in logs or error messages.
- **Background check results** — never store raw report content; store only status
  enum + external reference ID + verification date. The check vendor is the system
  of record for the actual report.
- **Payment data** — never touches your servers directly; Stripe Elements/Checkout
  handles card data, same pattern as Tap 2 Table's Stripe Terminal work.
- Consider whether COPPA applies (platform itself isn't "directed at children" if
  parents are the actual registrants/account holders — worth a real legal read
  before launch, not something to assume your way through).

---

## 7. Live draft tool — design note

Given Evan's answer (evaluation day → live draft → admin places players):

1. **Evaluation phase**: admins/evaluators score players against a season (skill
   rating, age, notes) — stored in `evaluations`, visible only to admins/coaches,
   not parents.
2. **Draft setup**: admin defines draft order (manual, snake, or randomized),
   assigns coaches/reps to teams, sets pick timer (optional).
3. **Live draft session**: realtime board via Supabase Realtime —
   - `draft_sessions` row tracks current state (whose pick, index, status)
   - Postgres changes broadcast to all connected clients (coaches, admin, spectators)
   - Presence channel shows who's connected/online during the draft
   - Admin can override/place a pick on any coach's behalf (per Evan's requirement
     that admin/league rep places the player, suggesting admin retains final control
     even in a coach-facing draft UI)
4. **Post-draft**: `draft_picks` → auto-generates `teams` roster; triggers
   registration record updates (`division_id`, team assignment) for all drafted
   players.

This is a good candidate for its own detailed design pass once we're actually
building it — draft tools have a lot of edge cases (trades, skipped picks,
disconnected clients resuming) worth working through deliberately.

---

## 8. Tournament hosting module

Structurally closer to a lightweight, separate registration flow than an extension
of season/division/team:

- A `tournament` is hosted by one organization but accepts `tournament_teams` that
  may be `is_external = true` — i.e., not members of the hosting org at all
- External team registration needs its own lighter signup (team name, contact,
  roster upload) — not the full player-by-player compliance pipeline used for
  regular season, since those players belong to a different league/organization
  entirely and compliance is presumably the responsibility of their home org
- Public bracket/schedule publishing, same pattern as season schedule publishing
- Payment: tournament entry fees via the hosting org's Stripe Connect account

---

## 9. Platform billing (leagues paying you)

Separate Stripe object graph from registration payments:

- `platform_subscriptions` — Stripe Billing subscription per organization
- Tiering likely by: number of registrants, number of seasons/divisions, or
  feature tier (e.g. tournament hosting as an add-on) — worth a real pricing
  strategy pass once the product is closer to launch, not now
- `ENFORCE_SUBSCRIPTION_LOCK`-style flag (same pattern as Tap 2 Table) so you can
  build subscription gating early but not turn on hard enforcement until ready

---

## 10. Design direction

"Fun and trendy" as a stated goal, in explicit contrast to SportsConnect/SportsEngine's
dated, corporate-forms feel. When we get to frontend work, pull in the
`frontend-design` skill for a real design-system pass — bold typography, distinct
color identity per league (tenant theming), motion for things like the draft board.
Not decided yet, flagged for later.

---

## 11. Suggested build order

Rough phase plan — not commitments, just a sane sequence:

1. **Foundation**: multi-tenant schema, org creation, auth, RLS policies
2. **Registration + payments**: player/coach/volunteer signup, Stripe Connect,
   refunds, historical records
3. **Compliance**: document upload, manual review flow, background-check vendor
   integration (Sterling or Ankored — decide after vendor evaluation)
4. **Evaluation + draft**: evaluation scoring, live draft tool (Realtime), team
   generation
5. **Scheduling + publishing**: season schedule builder, public-facing calendar/site
6. **League hub**: volunteer sign-up, events, general content pages
7. **Tournament hosting**: external team registration, brackets, public publishing
8. **Platform billing**: Stripe Billing, subscription tiers, enforcement flag
9. **Design polish pass**: frontend-design skill, tenant theming, motion

---

## Open questions for next session

- Sterling vs. Ankored — need a real vendor evaluation call/docs review before
  committing to an integration
- Draft mechanics: snake draft only, or configurable formats? Trades during draft?
- Does the platform need its own domain/brand name yet, or TBD?
- Legal review needed before launch: COPPA applicability, state-specific youth
  sports background check requirements (some states mandate specific providers
  or fingerprinting for certain roles)
- Pricing model for platform subscriptions — flat tier vs. per-registrant
