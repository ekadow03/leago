// app/admin/compliance/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import ComplianceReview from './compliance-review';
import Nav from '@/components/nav';

export default async function AdminCompliancePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/admin/compliance');
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

  const { data: records } = await supabase
    .from('compliance_records')
    .select(
      `
      id, type, status, review_notes, verified_at, document_id,
      person:people!compliance_records_person_id_fkey ( first_name, last_name, email ),
      document:documents ( id, original_filename, uploaded_at )
    `
    )
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false });

  return (
    <div className="admin-page">
      <Nav />
      <div className="admin-header">
        <h1>Compliance</h1>
        <p>{org.organizationName}</p>
      </div>
      <div className="admin-body">
        <ComplianceReview
          organizationId={org.organizationId}
          initialRecords={(records as any) ?? []}
        />
      </div>
    </div>
  );
}