// app/admin/branding/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import BrandingForm from './branding-form';
import Nav from '@/components/nav';

export default async function AdminBrandingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/admin/branding');
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

  const { data: fullOrg } = await supabase
    .from('organizations')
    .select('id, name, subdomain, branding_theme')
    .eq('id', org.organizationId)
    .single();

  return (
    <div className="admin-page">
      <Nav />
      <div className="admin-header">
        <h1>Branding</h1>
        <p>{org.organizationName} — customize how your public tournament pages look</p>
      </div>
      <div className="admin-body">
        <BrandingForm
          organizationId={org.organizationId}
          currentSubdomain={fullOrg?.subdomain ?? ''}
          currentLogoUrl={(fullOrg?.branding_theme as any)?.logoUrl ?? ''}
          currentPrimaryColor={(fullOrg?.branding_theme as any)?.primaryColor ?? ''}
        />
      </div>
    </div>
  );
}