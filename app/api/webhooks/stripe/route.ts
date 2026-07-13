// app/api/webhooks/stripe/route.ts
// Stripe webhook endpoint. This is the source of truth for payment status —
// never trust client-side "payment succeeded" callbacks alone, since those
// can be spoofed or interrupted. Configure this URL in the Stripe dashboard
// (or via `stripe listen` for local testing) and set STRIPE_WEBHOOK_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import Stripe from 'stripe';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const admin = createAdminClient();

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const { error } = await admin
        .from('registrations')
        .update({ payment_status: 'paid', status: 'confirmed' })
        .eq('stripe_payment_intent_id', pi.id);

      if (error) {
        console.error('Failed to update registration on payment_intent.succeeded:', error);
        return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const { error } = await admin
        .from('registrations')
        .update({ payment_status: 'failed' })
        .eq('stripe_payment_intent_id', pi.id);

      if (error) {
        console.error('Failed to update registration on payment_intent.payment_failed:', error);
        return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
      }
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      if (charge.payment_intent) {
        const paymentIntentId =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent.id;

        const { data: registration } = await admin
          .from('registrations')
          .select('id, amount_cents')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .single();

        if (registration) {
          const refundedTotal = charge.amount_refunded;
          const newStatus =
            refundedTotal >= registration.amount_cents ? 'refunded' : 'partially_refunded';

          await admin
            .from('registrations')
            .update({
              refunded_amount_cents: refundedTotal,
              payment_status: newStatus,
            })
            .eq('id', registration.id);
        }
      }
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}