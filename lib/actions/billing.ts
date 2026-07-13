'use server';

// lib/actions/billing.ts
// Platform subscription checkout. Uses Stripe Checkout (mode: subscription)
// rather than a custom Payment Element form — subscriptions have real
// lifecycle complexity (proration, renewal, dunning) that Checkout's
// hosted flow already handles correctly, so there's no good reason to
// reimplement it. Pricing is placeholder — see TIERS below and
// ARCHITECTURE.md §9, which flags platform pricing as an open question.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';
import { stripe } from '@/lib/stripe';
import { TIERS, TierKey } from '@/lib/billing-tiers';

export async function startSubscriptionCheckout(
  organizationId: string,
  tier: TierKey
): Promise<{ checkoutUrl: string }> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can manage billing.');
  }

  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from('organizations')
    .select('id, name, stripe_customer_id')
    .eq('id', organizationId)
    .single();

  if (error || !org) throw new Error('Organization not found.');

  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: org.name,
      metadata: { organization_id: organizationId },
    });
    customerId = customer.id;
    await admin.from('organizations').update({ stripe_customer_id: customerId }).eq('id', organizationId);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const tierInfo = TIERS[tier];

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `Leago — ${tierInfo.label} plan` },
          unit_amount: tierInfo.priceCents,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      },
    ],
    metadata: { organization_id: organizationId, tier },
    subscription_data: {
      metadata: { organization_id: organizationId, tier },
    },
    success_url: `${appUrl}/admin/billing?subscribed=true`,
    cancel_url: `${appUrl}/admin/billing?canceled=true`,
  });

  if (!session.url) throw new Error('Failed to create checkout session.');
  return { checkoutUrl: session.url };
}

export async function cancelSubscription(organizationId: string): Promise<void> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can manage billing.');
  }

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from('platform_subscriptions')
    .select('id, stripe_subscription_id')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .maybeSingle();

  if (!sub) throw new Error('No active subscription found.');

  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    cancel_at_period_end: true,
  });
}