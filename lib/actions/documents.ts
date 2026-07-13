'use server';

// lib/actions/documents.ts
// Uploads a compliance document (birth certificate, coach cert) and creates
// the tracking rows. Uses the admin client for both the Storage upload and
// the DB writes, since this needs to coordinate two operations atomically-
// ish — client-side RLS on Storage inserts can't easily do that. The real
// authorization check happens explicitly below, not via RLS on the insert.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface UploadDocumentInput {
  personId: string;
  organizationId: string;
  type: 'birth_certificate' | 'coach_cert';
  file: File;
}

export async function uploadComplianceDocument(
  input: UploadDocumentInput
): Promise<{ documentId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Must be logged in to upload documents.');
  }

  const { data: uploaderPerson } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!uploaderPerson) {
    throw new Error('No profile found for your account.');
  }

  const admin = createAdminClient();

  const isSelf = uploaderPerson.id === input.personId;
  let isAdmin = false;
  if (!isSelf) {
    const { data: membership } = await admin
      .from('organization_members')
      .select('id')
      .eq('organization_id', input.organizationId)
      .eq('person_id', uploaderPerson.id)
      .eq('role', 'admin')
      .maybeSingle();
    isAdmin = !!membership;
  }

  if (!isSelf && !isAdmin) {
    throw new Error('You can only upload your own documents, or an admin can upload on a member\'s behalf.');
  }

  const MAX_SIZE_BYTES = 10 * 1024 * 1024;
  const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

  if (input.file.size > MAX_SIZE_BYTES) {
    throw new Error('File is too large (max 10MB).');
  }
  if (!ALLOWED_TYPES.includes(input.file.type)) {
    throw new Error('File must be a PDF, JPG, or PNG.');
  }

  const fileExt = input.file.name.split('.').pop();
  const storagePath = `${input.personId}/${input.type}-${Date.now()}.${fileExt}`;

  const { error: uploadError } = await admin.storage
    .from('compliance-documents')
    .upload(storagePath, input.file, {
      contentType: input.file.type,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { data: document, error: docError } = await admin
    .from('documents')
    .insert({
      person_id: input.personId,
      type: input.type,
      storage_path: storagePath,
      original_filename: input.file.name,
      uploaded_by_person_id: uploaderPerson.id,
    })
    .select('id')
    .single();

  if (docError || !document) {
    await admin.storage.from('compliance-documents').remove([storagePath]);
    throw new Error(`Failed to record document: ${docError?.message}`);
  }

  const { error: complianceError } = await admin
    .from('compliance_records')
    .upsert(
      {
        person_id: input.personId,
        organization_id: input.organizationId,
        type: input.type,
        status: 'submitted',
        document_id: document.id,
      },
      { onConflict: 'person_id,organization_id,type' }
    );

  if (complianceError) {
    throw new Error(`Document uploaded but status tracking failed: ${complianceError.message}`);
  }

  return { documentId: document.id };
}