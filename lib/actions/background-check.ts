'use server';

// lib/actions/background-check.ts
//
// ⚠️ SCAFFOLD ONLY — NOT LIVE ⚠️
// This is ready to wire up once you have real Ankored API credentials and
// docs. Everything here is a best-guess based on how vendor integrations
// in this space typically work (see ARCHITECTURE.md §5 vendor research) —
// the actual request shape, auth method, and status values will need to
// be corrected against Ankored's real API reference once you have access.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

interface RequestBackgroundCheckInput {
  organizationId: string;
  personId: string;
  complianceRecordId: string;
}

export async function requestBackgroundCheck(input: RequestBackgroundCheckInput): Promise<void> {
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can request a background check.');
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

  // ---------------------------------------------------------------------
  // TODO once Ankored API access exists: replace this block with a real
  // fetch() call to their check-request endpoint. Expect something like:
  //
  //   const response = await fetch('https://api.ankored.com/v1/checks', {
  //     method: 'POST',
  //     headers: {
  //       Authorization: `Bearer ${process.env.ANKORED_API_KEY}`,
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({
  //       first_name: person.first_name,
  //       last_name: person.last_name,
  //       email: person.email,
  //       dob: person.dob,
  //       webhook_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/ankored`,
  //       external_reference: input.complianceRecordId,
  //     }),
  //   });
  //   const { check_id } = await response.json();
  //
  // Confirm the actual field names, auth scheme, and endpoint against
  // Ankored's real docs — this is a plausible guess, not confirmed.
  // ---------------------------------------------------------------------

  throw new Error(
    'Ankored integration not yet connected — this is a scaffold. Wire up the real API call above once you have credentials.'
  );

  // Once live, the success path should look roughly like:
  //
  // await admin
  //   .from('compliance_records')
  //   .update({
  //     status: 'pending',
  //     external_reference_id: check_id,
  //   })
  //   .eq('id', input.complianceRecordId);
}