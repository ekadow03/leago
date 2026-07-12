# League Platform — Phase 2: Registrations + Stripe Connect

Builds on Phase 1. Adds `registrations` + `refunds` tables, Stripe Connect
onboarding for leagues, PaymentIntent-based registration payments, and a
webhook handler to keep payment status accurate.

## What's in here

```
supabase/migrations/0002_registrations.sql   registrations + refunds tables, RLS
lib/supabase/admin.ts                        Service-role client (server-only)
lib/stripe.ts                                Stripe client singleton
lib/actions/registrations.ts                 createRegistration() Server Action
lib/actions/refunds.ts                       issueRefund() Server Action
lib/actions/stripe-connect.ts                startStripeConnectOnboarding()
app/api/webhooks/stripe/route.ts             Webhook handler (payment status sync)
```

## Setup

```bash
# 1. Install Stripe SDK
npm install stripe @stripe/stripe-js @stripe/react-stripe-js

# 2. Copy files into your project (mirroring the paths above)

# 3. Push the migration
cp supabase/migrations/0002_registrations.sql <your-project>/supabase/migrations/
npx supabase db push

# 4. Env vars — get these from the Stripe dashboard (dashboard.stripe.com/apikeys)
echo "STRIPE_SECRET_KEY=sk_test_..." >> .env.local
echo "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_..." >> .env.local
echo "NEXT_PUBLIC_APP_URL=http://localhost:3000" >> .env.local
# STRIPE_WEBHOOK_SECRET comes from step 5 below
```

**Use test-mode keys (`sk_test_...` / `pk_test_...`) until you're actually
ready to take real money.** Stripe Connect also has its own test mode — you
can fully exercise onboarding + payments + refunds without a real bank
account or real league.

## Local webhook testing

Stripe needs to reach your webhook endpoint to confirm payments — your
laptop isn't publicly reachable, so use the Stripe CLI to forward events:

```bash
brew install stripe/stripe-cli/stripe
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

That command prints a webhook signing secret (`whsec_...`) — put that in
`.env.local` as `STRIPE_WEBHOOK_SECRET`. Keep `stripe listen` running in a
terminal tab while you test locally; it's forwarding real Stripe test-mode
events to your machine.

To fire a test event without going through a full checkout flow:
```bash
stripe trigger payment_intent.succeeded
```

## Testing a full registration flow

1. Onboard a test org: call `startStripeConnectOnboarding(orgId)`, follow the
   returned URL — Stripe's test onboarding lets you skip real business/bank
   details with placeholder test data.
2. Call `createRegistration(...)` with a test person/season — returns a
   `clientSecret`.
3. Confirm the payment client-side with Stripe.js test card `4242 4242 4242
   4242`, any future expiry, any CVC.
4. Watch the `stripe listen` terminal — you should see `payment_intent.succeeded`
   forwarded, and the registration's `payment_status` should flip to `paid`
   in Supabase.

## What's deliberately NOT here yet

- No registration **form/UI** yet — these are the Server Actions and schema
  only. Building the actual signup pages (player info, division selection,
  Stripe Elements card form) is the natural next slice within Phase 2, or
  we can move to Phase 3 (compliance) and come back — your call.
- Platform billing (leagues paying *you* a subscription) is Phase 8, uses
  Stripe Billing, not Connect — separate object graph entirely, not touched
  here.
- No admin UI for viewing/issuing refunds — `issueRefund()` exists as a
  callable action but needs a page to call it from.

## A correction from last message

I initially pinned the Stripe API version to `2025-01-27.acacia` in
`lib/stripe.ts` from memory, then checked and found the current version is
`2026-06-24.dahlia` — the file now has the correct one. Worth knowing this
moves roughly monthly; recheck at https://docs.stripe.com/api/versioning
before any future bump rather than trusting either of our memories on it.

## Next session

Natural next steps, in rough order:
1. Registration + payment UI (Stripe Elements form)
2. Phase 3: compliance (document upload, background check vendor integration)
3. Admin dashboard for viewing registrations/issuing refunds

Bring this repo state + `ARCHITECTURE.md` into whichever you pick.
