// app/admin/registrations/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import RegistrationsTable from './registrations-table';
import Nav from '@/components/nav';

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
      <div className="admin-page">
        <Nav />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>You're not an admin of any organization, so there's nothing to manage here.</p>
        </div>
      </div>
    );
  }

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
    <div className="admin-page">
      <Nav />
      <div className="admin-header">
        <h1>Registrations</h1>
        <p>{org.organizationName}</p>
      </div>

      {error && (
        <div className="admin-body">
          <p style={{ color: '#B23A2E' }}>Failed to load: {error.message}</p>
        </div>
      )}

      <div className="admin-body">
        <RegistrationsTable initialRegistrations={(registrations as any) ?? []} />
      </div>
    </div>
  );
}