'use server';

// lib/actions/registration-documents.ts
//
// Birth certificate upload for the *registration* flow — distinct from
// lib/actions/documents.ts (the admin compliance-review system), which is
// self-only and hardcoded to birth_certificate/coach_cert as a standing
// compliance requirement tracked independently of any one registration.
// This one attaches a file directly to a registration via
// registrations.birth_certificate_path (0020_registration_and_household.sql),
// scoped to whichever season's registration_settings.require_birth_certificate
// is on. Reuses the same private compliance-documents storage bucket —
// no reason to stand up a second bucket for the same kind of file.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface UploadInput {
  personId: string; // whoever the birth certificate is FOR (registrant)
  file: File;
}

type UploadResult = { storagePath: string } | { error: string };

export async function uploadRegistrationBirthCertificate(input: UploadInput): Promise<UploadResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Must be logged in to upload documents.' };
    }

    const { data: uploaderPerson } = await supabase
      .from('people')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (!uploaderPerson) {
      return { error: 'No profile found for your account.' };
    }

    const admin = createAdminClient();

    const isSelf = uploaderPerson.id === input.personId;
    let isGuardian = false;
    if (!isSelf) {
      const { data: link } = await admin
        .from('guardians')
        .select('id')
        .eq('guardian_person_id', uploaderPerson.id)
        .eq('dependent_person_id', input.personId)
        .maybeSingle();
      isGuardian = !!link;
    }

    if (!isSelf && !isGuardian) {
      return { error: 'You can only upload a birth certificate for yourself or a player in your household.' };
    }

    const MAX_SIZE_BYTES = 10 * 1024 * 1024;
    const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

    if (input.file.size > MAX_SIZE_BYTES) {
      return { error: 'File is too large (max 10MB).' };
    }
    if (!ALLOWED_TYPES.includes(input.file.type)) {
      return { error: 'File must be a PDF, JPG, or PNG.' };
    }

    const fileExt = input.file.name.split('.').pop();
    const storagePath = `${input.personId}/registration-birth-certificate-${Date.now()}.${fileExt}`;

    const { error: uploadError } = await admin.storage
      .from('compliance-documents')
      .upload(storagePath, input.file, {
        contentType: input.file.type,
        upsert: false,
      });

    if (uploadError) {
      return { error: `Upload failed: ${uploadError.message}` };
    }

    return { storagePath };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
