'use server';

// lib/actions/registrations.ts
// Registration creation flow. This runs server-side only (Server Action),
// using the admin client because we need to write the registrations row
// and create the Stripe PaymentIntent as a matched pair — RLS would be the
// wrong tool here since the writing "user" at this point is really "the
// registration flow acting on the submitter's behalf," and the actual
// authorization check (is this person allowed to register for this org's
// season) is done explicitly below rather than delegated to a policy.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';

interface CreateRegistrationInput {
  organizationId: string;
  seasonId: string;
  personId: string; // the registrant (may be a minor — see submittedByPersonId)
  registrationType: 'player' | 'coach' | 'volunteer';
  amountCents: number;
  submittedByPersonId?: string; // parent/guardian, if different from personId
}

interface CreateRegistrationResult {
  registrationId: string;
  clientSecret: string; // for Stripe Elements on the client
}

export async function createRegistration(
  input: CreateRegistrationInput
): Promise<CreateRegistrationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Must be logged in to register.');
  }

  // Confirm the logged-in user is actually the registrant or the submitter
  // they claim to be — this is the real authorization check, since we're
  // about to use the admin client for the writes.
  const { data: submitterPerson } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!submitterPerson) {
    throw new Error('No person record found for the logged-in user.');
  }

  const claimedSubmitter = input.submittedByPersonId ?? input.personId;
  if (claimedSubmitter !== submitterPerson.id) {
    throw new Error('Cannot submit a registration on behalf of a different account.');
  }

  const admin = createAdminClient();

  // Look up the org's Stripe Connect account — payment must flow to the
  // league, not the platform.
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .select('stripe_connect_account_id')
    .eq('id', input.organizationId)
    .single();

  if (orgError || !org?.stripe_connect_account_id) {
    throw new Error('This organization has not completed payment setup.');
  }

  // Guard against duplicate active registrations (see comment in
  // 0002_registrations.sql — the DB constraint alone doesn't prevent this
  // since it includes `status`, so we check explicitly here).
  const { data: existing } = await admin
    .from('registrations')
    .select('id')
    .eq('person_id', input.personId)
    .eq('season_id', input.seasonId)
    .eq('registration_type', input.registrationType)
    .in('status', ['pending', 'confirmed', 'waitlisted'])
    .maybeSingle();

  if (existing) {
    throw new Error('An active registration already exists for this person and season.');
  }

  // Zero-cost registrations (e.g. some volunteer or coach roles) skip
  // Stripe entirely — PaymentIntents can't be created for $0, and there's
  // nothing to charge anyway. Mark confirmed/paid immediately instead.
  if (input.amountCents === 0) {
    const { data: registration, error: regError } = await admin
      .from('registrations')
      .insert({
        organization_id: input.organizationId,
        season_id: input.seasonId,
        person_id: input.personId,
        registration_type: input.registrationType,
        submitted_by_person_id: input.submittedByPersonId ?? null,
        amount_cents: 0,
        payment_status: 'paid',
        status: 'confirmed',
      })
      .select('id')
      .single();

    if (regError || !registration) {
      throw new Error(`Failed to create registration: ${regError?.message}`);
    }

    return { registrationId: registration.id, clientSecret: '' };
  }

  // Platform fee — flat example; replace with real pricing once decided
  // (ARCHITECTURE.md §9 flags platform pricing as an open question).
  const platformFeeCents = Math.round(input.amountCents * 0.03);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: input.amountCents,
    currency: 'usd',
    application_fee_amount: platformFeeCents,
    transfer_data: {
      destination: org.stripe_connect_account_id,
    },
    metadata: {
      organization_id: input.organizationId,
      season_id: input.seasonId,
      person_id: input.personId,
      registration_type: input.registrationType,
    },
  });

  const { data: registration, error: regError } = await admin
    .from('registrations')
    .insert({
      organization_id: input.organizationId,
      season_id: input.seasonId,
      person_id: input.personId,
      registration_type: input.registrationType,
      submitted_by_person_id: input.submittedByPersonId ?? null,
      amount_cents: input.amountCents,
      stripe_payment_intent_id: paymentIntent.id,
      payment_status: 'processing',
      status: 'pending',
    })
    .select('id')
    .single();

  if (regError || !registration) {
    // Cancel the PaymentIntent so we don't leave an orphaned charge attempt
    // with no corresponding registration row.
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
    throw new Error(`Failed to create registration: ${regError?.message}`);
  }

  return {
    registrationId: registration.id,
    clientSecret: paymentIntent.client_secret!,
  };
}
