'use server';

// lib/actions/stripe-connect.ts
// Uses Express Connect accounts — Standard accounts get full Stripe
// Dashboard login access, which requires the account holder to set up
// account-level security (2FA) even in test mode.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';
import { stripe } from '@/lib/stripe';

export async function startStripeConnectOnboarding(
  organizationId: string
): Promise<{ onboardingUrl: string }> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can set up payments.');
  }

  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from('organizations')
    .select('id, name, stripe_connect_account_id')
    .eq('id', organizationId)
    .single();

  if (error || !org) {
    throw new Error('Organization not found.');
  }

  let accountId = org.stripe_connect_account_id;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: { organization_id: organizationId },
    });
    accountId = account.id;

    await admin
      .from('organizations')
      .update({ stripe_connect_account_id: accountId })
      .eq('id', organizationId);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${appUrl}/admin/settings/payments?refresh=true`,
    return_url: `${appUrl}/admin/settings/payments?onboarded=true`,
    type: 'account_onboarding',
  });

  return { onboardingUrl: accountLink.url };
}
