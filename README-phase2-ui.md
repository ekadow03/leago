# League Platform — Phase 2 (UI): Auth + Registration Form

Builds on the Phase 2 backend (already deployed and payment-tested). Adds:
signup/login, session middleware, public registration browsing, and a real
registration form with type selector + Stripe Elements payment.

## New files

```
middleware.ts                                   Session refresh (place at project ROOT)
lib/actions/auth.ts                              signUp() / logIn() / logOut()
app/login/page.tsx
app/signup/page.tsx
app/signup/check-email/page.tsx
app/auth/callback/route.ts                       Handles email confirmation links
app/register/page.tsx                            Browse open divisions
app/register/[divisionId]/page.tsx               Server component — fetches data
app/register/[divisionId]/registration-form.tsx  Client component — the actual form
supabase/migrations/0003_public_registration_visibility.sql
supabase/migrations/0004_division_pricing.sql
supabase/seed_test_league.sql                    Test data — NOT a migration, see below
```

## Setup, in order

**1. Place `middleware.ts` at your project ROOT** — not inside `app/`, not
inside `lib/`. Same level as `package.json`. This is a Next.js requirement.

**2. Push the two new migrations:**
```bash
npx supabase db push
```
Should prompt for `0003_public_registration_visibility.sql` and
`0004_division_pricing.sql`.

**3. Seed test data.** `seed_test_league.sql` is NOT a migration — don't put
it in `supabase/migrations/`. Run it manually in the Supabase SQL Editor,
following the inline instructions (you'll copy the returned `id` between
each insert). This creates one test org, an open season, and three priced
divisions to register for.

**4. Onboard the seeded org onto Stripe Connect.** `createRegistration()`
requires `stripe_connect_account_id` to be set — the seed script doesn't do
this since it needs a real Stripe onboarding flow. Easiest way to trigger
it manually for now (no admin UI exists yet):
```ts
// Temporarily call this from anywhere server-side, e.g. paste into a
// scratch API route, or run via a one-off script — swap in your seeded org's id.
import { startStripeConnectOnboarding } from '@/lib/actions/stripe-connect';
const { onboardingUrl } = await startStripeConnectOnboarding('<ORG_ID>');
console.log(onboardingUrl);
```
Visit the printed URL and complete Stripe's test-mode onboarding (you can
use placeholder test business info — Stripe's test mode has a "skip"
shortcut for most fields).

**5. Check your Supabase auth email settings.** By default, Supabase
requires email confirmation before login. For faster local testing, you can
disable this: **Authentication → Providers → Email → toggle off "Confirm
email"** in your Supabase dashboard. (Leave it ON before real launch —
this is a local-dev convenience only.)

## Testing the full flow

1. `npm run dev`
2. Visit `/signup`, create an account
3. If email confirmation is on: check your inbox, click the link (routes
   through `/auth/callback`), then `/login`
   If email confirmation is off: go straight to `/login`
4. After login you land on `/register` — should show your seeded divisions
5. Click one, pick "Player" (priced) or "Coach"/"Volunteer" (free)
6. Player: continues to a real Stripe Elements form — test card `4242 4242
   4242 4242`
   Coach/Volunteer: confirms immediately, no payment step
7. Check Supabase Table Editor → `registrations` — should show a new row
   with `status = confirmed` and, for the paid path, `payment_status = paid`
   once the webhook fires (keep `stripe listen` running, same as before)

## Known simplifications (worth knowing, not necessarily fixing now)

- **Self-registration only.** The form registers the logged-in user as the
  registrant — no "register my child" flow yet, even though the schema
  (`submitted_by_person_id`) supports it. That's a real feature to build
  when you're ready, not a bug.
- **Coach/volunteer are always free** in this version — the form hardcodes
  that assumption. Real per-role pricing rules can replace that logic in
  `registration-form.tsx` when needed.
- **`divisions.price_cents`** is new (0004) and is being used as both the
  registration-time pricing bracket AND the eventual draft-time team
  placement — see the comment in that migration for why that's intentional,
  not an oversight, but worth remembering when the draft tool gets built.
- **No styling system yet** — everything's inline styles for speed. Real
  design pass (per ARCHITECTURE.md §10, "fun and trendy") comes later,
  intentionally deferred rather than styling throwaway-feeling MVP screens.

## Next session

Natural next steps: admin dashboard (view/manage registrations, issue
refunds through a UI instead of only via the Server Action), or Phase 3
(compliance/background checks). Your call — bring this repo state.
