'use server';

// lib/actions/registrations.ts

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';
import { isEligibleForDivision } from '@/lib/age-eligibility';

interface CreateRegistrationInput {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  personId: string;
  registrationType: 'player' | 'coach' | 'volunteer';
  submittedByPersonId?: string;
  waiverSignedName?: string;
  birthCertificatePath?: string;
  jerseySize?: string;
  hatSize?: string;
  jerseyNumber?: string;
  yearsExperience?: number;
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

  const admin = createAdminClient();

  const claimedSubmitter = input.submittedByPersonId ?? input.personId;
  if (claimedSubmitter !== submitterPerson.id) {
    throw new Error('Cannot submit a registration on behalf of a different account.');
  }

  // Registering someone other than yourself is only allowed for a
  // household member you're the guardian of (see
  // 0020_registration_and_household.sql — guardians is a global,
  // not-org-scoped table so this check doesn't need organizationId).
  if (input.personId !== submitterPerson.id) {
    const { data: guardianLink } = await admin
      .from('guardians')
      .select('id')
      .eq('guardian_person_id', submitterPerson.id)
      .eq('dependent_person_id', input.personId)
      .maybeSingle();

    if (!guardianLink) {
      throw new Error('You can only register yourself or a player in your household.');
    }
  }

  // Defense in depth: the division/season/org chain is exactly what it
  // claims to be, and the price the client displayed matches what we
  // actually charge — the admin client bypasses RLS and the client
  // controls every one of these ids, so none of it can be trusted as-is.
  const { data: division, error: divisionError } = await admin
    .from('divisions')
    .select('id, season_id, age_min, age_max, price_cents, seasons ( id, organization_id, age_cutoff_date )')
    .eq('id', input.divisionId)
    .single();

  const seasonRow = division?.seasons as unknown as
    | { id: string; organization_id: string; age_cutoff_date: string | null }
    | null;

  if (
    divisionError ||
    !division ||
    division.season_id !== input.seasonId ||
    !seasonRow ||
    seasonRow.id !== input.seasonId ||
    seasonRow.organization_id !== input.organizationId
  ) {
    throw new Error('This division is not available for registration.');
  }

  if (input.registrationType === 'player') {
    const { data: registrant } = await admin
      .from('people')
      .select('dob')
      .eq('id', input.personId)
      .single();

    const eligible = isEligibleForDivision(
      registrant?.dob ?? null,
      seasonRow.age_cutoff_date,
      division.age_min,
      division.age_max
    );

    if (!eligible) {
      throw new Error(
        registrant?.dob
          ? 'This player is outside the age range for this division.'
          : 'A date of birth is required before registering for this division.'
      );
    }
  }

  const { data: settings } = await admin
    .from('registration_settings')
    .select(
      'require_waiver, require_birth_certificate, offer_jersey_size, jersey_sizes, offer_hat_size, hat_sizes, offer_jersey_number, offer_years_experience'
    )
    .eq('season_id', input.seasonId)
    .maybeSingle();

  if (settings?.require_waiver && !input.waiverSignedName?.trim()) {
    throw new Error('You must sign the waiver to complete registration.');
  }
  if (settings?.require_birth_certificate && !input.birthCertificatePath) {
    throw new Error('A birth certificate upload is required to complete registration.');
  }
  if (settings?.offer_jersey_size && input.jerseySize && !settings.jersey_sizes.includes(input.jerseySize)) {
    throw new Error('Invalid jersey size selected.');
  }
  if (settings?.offer_hat_size && input.hatSize && !settings.hat_sizes.includes(input.hatSize)) {
    throw new Error('Invalid hat size selected.');
  }

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

  // Coach/volunteer roles are free; a player's amount is the division's
  // price — never taken from the client.
  const amountCents = input.registrationType === 'player' ? division.price_cents : 0;

  const baseInsert = {
    organization_id: input.organizationId,
    season_id: input.seasonId,
    division_id: input.divisionId,
    person_id: input.personId,
    registration_type: input.registrationType,
    submitted_by_person_id: input.submittedByPersonId ?? null,
    waiver_signed_name: input.waiverSignedName?.trim() || null,
    waiver_signed_at: input.waiverSignedName?.trim() ? new Date().toISOString() : null,
    birth_certificate_path: input.birthCertificatePath ?? null,
    jersey_size: input.jerseySize ?? null,
    hat_size: input.hatSize ?? null,
    jersey_number: input.jerseyNumber ?? null,
    years_experience: input.yearsExperience ?? null,
  };

  // Zero-cost registrations (e.g. some volunteer or coach roles, or a free
  // division) skip Stripe entirely — PaymentIntents can't be created for $0.
  if (amountCents === 0) {
    const { data: registration, error: regError } = await admin
      .from('registrations')
      .insert({
        ...baseInsert,
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

  const platformFeeCents = Math.round(amountCents * 0.03);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    application_fee_amount: platformFeeCents,
    transfer_data: {
      destination: org.stripe_connect_account_id,
    },
    metadata: {
      organization_id: input.organizationId,
      season_id: input.seasonId,
      division_id: input.divisionId,
      person_id: input.personId,
      registration_type: input.registrationType,
    },
  });

  const { data: registration, error: regError } = await admin
    .from('registrations')
    .insert({
      ...baseInsert,
      amount_cents: amountCents,
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
