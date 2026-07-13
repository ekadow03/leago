// app/admin/registrations/page.tsx
//
// Lists all registrations for the orgs the logged-in user admins, with
// filtering by status and a refund action per row. Requires the user to be
// an org admin (org-context.ts) — non-admins see an access-denied message
// rather than an empty/broken table.

import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import RegistrationsTable from './registrations-table';

export default async function AdminRegistrationsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/admin/registrations');
  }

  const memberships = await getCurrentUserMemberships();
  const adminOrgs = memberships.filter((m) => m.roles.includes('admin'));

  if (adminOrgs.length === 0) {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'system-ui' }}>
        <h1>Admin dashboard</h1>
        <p style={{ color: '#666' }}>
          You're not an admin of any organization, so there's nothing to
          manage here.
        </p>
      </div>
    );
  }

  // Single-org assumption for this first version — if the user admins
  // multiple orgs, show the first one. A real org-switcher is a natural
  // follow-up once there's more than one org to actually switch between.
  const org = adminOrgs[0];

  const { data: registrations, error } = await supabase
    .from('registrations')
    .select(
      `
      id, registration_type, status, payment_status,
      amount_cents, refunded_amount_cents, created_at, stripe_payment_intent_id,
      person:people!registrations_person_id_fkey ( first_name, last_name, email ),
      season:seasons ( name )
    `
    )
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false });

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>{org.organizationName} — Registrations</h1>

      {error && <p style={{ color: 'red' }}>Failed to load: {error.message}</p>}

      <RegistrationsTable
        initialRegistrations={(registrations as any) ?? []}
      />
    </div>
  );
}