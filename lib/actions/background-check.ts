'use server';

// lib/actions/background-check.ts
//
// ⚠️ SCAFFOLD ONLY — NOT LIVE ⚠️

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';

interface RequestBackgroundCheckInput {
  organizationId: string;
  personId: string;
  complianceRecordId: string;
}

export async function requestBackgroundCheck(input: RequestBackgroundCheckInput): Promise<void> {
  const authorized = await requireOrgPermission(input.organizationId, 'manage_compliance');
  if (!authorized) {
    throw new Error('You do not have permission to request a background check.');
  }

  const admin = createAdminClient();

  const { data: person } = await admin
    .from('people')
    .select('first_name, last_name, email, dob')
    .eq('id', input.personId)
    .single();

  if (!person) {
    throw new Error('Person not found.');
  }

  // TODO once Ankored API access exists: replace this block with a real
  // fetch() call to their check-request endpoint.

  throw new Error(
    'Ankored integration not yet connected — this is a scaffold. Wire up the real API call above once you have credentials.'
  );
}
