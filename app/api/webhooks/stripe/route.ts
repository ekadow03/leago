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

      const { data: reg, error: regError } = await admin
        .from('registrations')
        .update({ payment_status: 'paid', status: 'confirmed' })
        .eq('stripe_payment_intent_id', pi.id)
        .select('id');

      if (regError) {
        console.error('Failed to update registration on payment_intent.succeeded:', regError);
        return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
      }

      if (!reg || reg.length === 0) {
        const { error: teamError } = await admin
          .from('tournament_teams')
          .update({ payment_status: 'paid', status: 'confirmed' })
          .eq('stripe_payment_intent_id', pi.id);

        if (teamError) {
          console.error('Failed to update tournament team on payment_intent.succeeded:', teamError);
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
        }
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;

      const { data: reg, error: regError } = await admin
        .from('registrations')
        .update({ payment_status: 'failed' })
        .eq('stripe_payment_intent_id', pi.id)
        .select('id');

      if (regError) {
        console.error('Failed to update registration on payment_intent.payment_failed:', regError);
        return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
      }

      if (!reg || reg.length === 0) {
        const { error: teamError } = await admin
          .from('tournament_teams')
          .update({ payment_status: 'failed' })
          .eq('stripe_payment_intent_id', pi.id);

        if (teamError) {
          console.error('Failed to update tournament team on payment_intent.payment_failed:', teamError);
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
        }
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
        } else {
          const { data: team } = await admin
            .from('tournament_teams')
            .select('id, amount_cents')
            .eq('stripe_payment_intent_id', paymentIntentId)
            .single();

          if (team) {
            const refundedTotal = charge.amount_refunded;
            await admin
              .from('tournament_teams')
              .update({
                payment_status: refundedTotal >= team.amount_cents ? 'refunded' : 'paid',
              })
              .eq('id', team.id);
          }
        }
      }
      break;
    }

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'subscription' && session.subscription) {
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
        const organizationId = session.metadata?.organization_id;
        const tier = session.metadata?.tier;

        if (organizationId && tier) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const periodEnd = subscription.items.data[0]?.current_period_end;

          await admin.from('platform_subscriptions').upsert(
            {
              organization_id: organizationId,
              stripe_subscription_id: subscriptionId,
              tier,
              status: 'active',
              current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
            },
            { onConflict: 'stripe_subscription_id' }
          );

          await admin
            .from('organizations')
            .update({ subscription_tier: tier, subscription_status: 'active' })
            .eq('id', organizationId);
        }
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const organizationId = subscription.metadata?.organization_id;

      let status: 'active' | 'past_due' | 'canceled' | 'incomplete';
      if (subscription.status === 'active' || subscription.status === 'trialing') status = 'active';
      else if (subscription.status === 'past_due' || subscription.status === 'unpaid') status = 'past_due';
      else if (subscription.status === 'canceled') status = 'canceled';
      else status = 'incomplete';

      await admin
        .from('platform_subscriptions')
        .update({
          status,
          current_period_end: subscription.items.data[0]?.current_period_end
            ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
            : null,
        })
        .eq('stripe_subscription_id', subscription.id);

      if (organizationId) {
        await admin
          .from('organizations')
          .update({ subscription_status: status })
          .eq('id', organizationId);
      }
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}