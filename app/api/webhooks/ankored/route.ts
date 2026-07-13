// app/api/webhooks/ankored/route.ts
//
// ⚠️ SCAFFOLD ONLY — NOT LIVE ⚠️
// This is where Ankored would POST status updates once a background
// check moves through their pipeline. Everything here — the signature
// verification, the payload shape, the status values — is a best guess
// based on how similar vendor webhooks typically work (see the pattern
// used for Stripe's webhook in app/api/webhooks/stripe/route.ts), NOT
// confirmed against Ankored's actual docs. Correct all of this once you
// have real API access.
//
// Once live, register this URL with Ankored as your webhook endpoint:
// https://yourdomain.com/api/webhooks/ankored

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const STATUS_MAP: Record<string, string> = {
  clear: 'verified',
  eligible: 'verified',
  consider: 'rejected',
  ineligible: 'rejected',
  expired: 'expired',
};

export async function POST(req: NextRequest) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const externalReferenceId: string | undefined = payload.external_reference ?? payload.check_id;
  const vendorStatus: string | undefined = payload.status;

  if (!externalReferenceId || !vendorStatus) {
    return NextResponse.json({ error: 'Missing expected fields' }, { status: 400 });
  }

  const mappedStatus = STATUS_MAP[vendorStatus.toLowerCase()];
  if (!mappedStatus) {
    console.warn(`Unrecognized Ankored status: ${vendorStatus}`);
    return NextResponse.json({ received: true, note: 'status not mapped' });
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from('compliance_records')
    .update({
      status: mappedStatus,
      verified_at: mappedStatus === 'verified' ? new Date().toISOString() : null,
    })
    .eq('external_reference_id', externalReferenceId);

  if (error) {
    console.error('Failed to update compliance record from Ankored webhook:', error);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}