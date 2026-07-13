'use server';

// lib/actions/compliance.ts
// Admin review of submitted compliance documents — approve/reject, and a
// short-lived signed URL to actually view the file (never a public URL,
// since the bucket is private per 0006_compliance.sql).

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';
import { createClient } from '@/lib/supabase/server';

export async function reviewComplianceRecord(
  organizationId: string,
  recordId: string,
  status: 'verified' | 'rejected',
  notes?: string
): Promise<void> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can review compliance documents.');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: reviewerPerson } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', user!.id)
    .single();

  const admin = createAdminClient();

  const { error } = await admin
    .from('compliance_records')
    .update({
      status,
      review_notes: notes ?? null,
      reviewed_by_person_id: reviewerPerson?.id ?? null,
      verified_at: status === 'verified' ? new Date().toISOString() : null,
    })
    .eq('id', recordId);

  if (error) {
    throw new Error(`Failed to update review status: ${error.message}`);
  }
}

export async function getDocumentSignedUrl(organizationId: string, documentId: string): Promise<string> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can view compliance documents.');
  }

  const admin = createAdminClient();

  const { data: document, error: docError } = await admin
    .from('documents')
    .select('storage_path')
    .eq('id', documentId)
    .single();

  if (docError || !document) {
    throw new Error('Document not found.');
  }

  const { data, error } = await admin.storage
    .from('compliance-documents')
    .createSignedUrl(document.storage_path, 60);

  if (error || !data) {
    throw new Error(`Failed to generate document link: ${error?.message}`);
  }

  return data.signedUrl;
}