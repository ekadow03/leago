'use server';

// lib/actions/registration-settings.ts
//
// Admin CRUD for the fixed, per-season set of registration fields
// (0020_registration_and_household.sql). Returns { error } instead of
// throwing — see the comment in lib/actions/onboarding.ts for why.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';

interface RegistrationSettingsInput {
  organizationId: string;
  seasonId: string;
  requireWaiver: boolean;
  waiverText: string;
  requireBirthCertificate: boolean;
  offerJerseySize: boolean;
  jerseySizes: string[];
  offerHatSize: boolean;
  hatSizes: string[];
  offerJerseyNumber: boolean;
  offerYearsExperience: boolean;
}

type Result = { ok: true } | { error: string };

export async function upsertRegistrationSettings(input: RegistrationSettingsInput): Promise<Result> {
  try {
    const authorized = await requireOrgPermission(input.organizationId, 'manage_registrations');
    if (!authorized) {
      return { error: 'You do not have permission to edit registration settings.' };
    }

    const admin = createAdminClient();

    const { data: season } = await admin
      .from('seasons')
      .select('id, organization_id')
      .eq('id', input.seasonId)
      .single();

    if (!season || season.organization_id !== input.organizationId) {
      return { error: 'Season not found for this organization.' };
    }

    const { error } = await admin.from('registration_settings').upsert(
      {
        season_id: input.seasonId,
        require_waiver: input.requireWaiver,
        waiver_text: input.waiverText.trim() || null,
        require_birth_certificate: input.requireBirthCertificate,
        offer_jersey_size: input.offerJerseySize,
        jersey_sizes: input.jerseySizes,
        offer_hat_size: input.offerHatSize,
        hat_sizes: input.hatSizes,
        offer_jersey_number: input.offerJerseyNumber,
        offer_years_experience: input.offerYearsExperience,
      },
      { onConflict: 'season_id' }
    );

    if (error) {
      return { error: `Failed to save registration settings: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
