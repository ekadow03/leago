'use server';

// lib/actions/registrations.ts

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';

interface CreateRegistrationInput {
  organizationId: string;
  seasonId: string;
  personId: string;
  registrationType: 'player' | 'coach' | 'volunteer';
  amountCents: number;
  submittedByPersonId?: string;
}

interface CreateRegistrationResult {
  registrationId: string;
  clientSecret: string;
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

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .select('stripe_connect_account_id')
    .eq('id', input.organizationId)
    .single();

  if (orgError || !org?.stripe_connect_account_id) {
    throw new Error('This organization has not completed payment setup.');
  }

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
  // Stripe entirely — PaymentIntents can't be created for $0.
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
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
    throw new Error(`Failed to create registration: ${regError?.message}`);
  }

  return {
    registrationId: registration.id,
    clientSecret: paymentIntent.client_secret!,
  };
}
