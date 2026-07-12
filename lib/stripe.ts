// lib/stripe.ts
// Single Stripe client instance, server-only.

import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-06-24.dahlia', // pin explicitly; bump deliberately, not implicitly.
  // Check https://docs.stripe.com/api/versioning for the current version
  // before bumping — don't just match whatever the installed SDK defaults to.
});
