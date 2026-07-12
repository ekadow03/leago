'use server';

// lib/actions/refunds.ts
// Admin-initiated refunds. RLS on registrations/refunds already restricts
// who can reach this (org admins only), but we double-check here too since
// the admin client bypasses RLS for the actual writes.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';
import { stripe } from '@/lib/stripe';

interface IssueRefundInput {
  registrationId: string;
  amountCents: number; // partial refunds allowed — must be <= remaining refundable amount
  reason?: string;
}

export async function issueRefund(input: IssueRefundInput): Promise<{ refundId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Must be logged in.');
  }

  const admin = createAdminClient();

  const { data: registration, error: regError } = await admin
    .from('registrations')
    .select('id, organization_id, amount_cents, refunded_amount_cents, stripe_payment_intent_id, payment_status')
    .eq('id', input.registrationId)
    .single();

  if (regError || !registration) {
    throw new Error('Registration not found.');
  }

  const isAdmin = await requireOrgAdmin(registration.organization_id);
  if (!isAdmin) {
    throw new Error('Only an organization admin can issue refunds.');
  }

  if (!registration.stripe_payment_intent_id) {
    throw new Error('No payment on this registration to refund.');
  }

  const remainingRefundable = registration.amount_cents - registration.refunded_amount_cents;
  if (input.amountCents > remainingRefundable) {
    throw new Error(
      `Refund amount exceeds remaining refundable balance ($${(remainingRefundable / 100).toFixed(2)}).`
    );
  }

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  const { data: adminPerson } = await admin
    .from('people')
    .select('id')
    .eq('auth_user_id', currentUser!.id)
    .single();

  const stripeRefund = await stripe.refunds.create({
    payment_intent: registration.stripe_payment_intent_id,
    amount: input.amountCents,
    reason: 'requested_by_customer',
    metadata: {
      registration_id: registration.id,
      initiated_by_person_id: adminPerson?.id ?? '',
    },
  });

  const { error: refundInsertError } = await admin.from('refunds').insert({
    registration_id: registration.id,
    amount_cents: input.amountCents,
    reason: input.reason ?? null,
    stripe_refund_id: stripeRefund.id,
    initiated_by_person_id: adminPerson?.id ?? null,
  });

  if (refundInsertError) {
    // The Stripe refund already happened — don't silently swallow this.
    // A webhook-driven reconciliation job is the real fix long-term; for
    // now, surface loudly so it gets manually reconciled.
    throw new Error(
      `Refund succeeded in Stripe (${stripeRefund.id}) but failed to record locally: ${refundInsertError.message}. Reconcile manually.`
    );
  }

  const newRefundedTotal = registration.refunded_amount_cents + input.amountCents;
  const newPaymentStatus =
    newRefundedTotal >= registration.amount_cents ? 'refunded' : 'partially_refunded';

  await admin
    .from('registrations')
    .update({
      refunded_amount_cents: newRefundedTotal,
      payment_status: newPaymentStatus,
    })
    .eq('id', registration.id);

  return { refundId: stripeRefund.id };
}
