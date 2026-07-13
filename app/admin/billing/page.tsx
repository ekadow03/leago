// app/admin/billing/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import BillingPanel from './billing-panel';
import Nav from '@/components/nav';

export default async function AdminBillingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/admin/billing');
  }

  const memberships = await getCurrentUserMemberships();
  const adminOrgs = memberships.filter((m) => m.roles.includes('admin'));

  if (adminOrgs.length === 0) {
    return (
      <div className="admin-page">
        <Nav />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>You're not an admin of any organization.</p>
        </div>
      </div>
    );
  }

  const org = adminOrgs[0];

  const { data: subscription } = await supabase
    .from('platform_subscriptions')
    .select('id, tier, status, current_period_end')
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false })
    .maybeSingle();

  return (
    <div className="admin-page">
      <Nav />
      <div className="admin-header">
        <h1>Billing</h1>
        <p>{org.organizationName}</p>
      </div>
      <div className="admin-body">
        <BillingPanel organizationId={org.organizationId} organizationName={org.organizationName} subscription={subscription} />
      </div>
    </div>
  );
}
