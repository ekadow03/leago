// app/compliance/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ComplianceUploadForm from './compliance-upload-form';
import Nav from '@/components/nav';

export default async function CompliancePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/compliance');
  }

  const { data: person } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!person) {
    return (
      <div className="admin-page">
        <Nav />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>No profile found for your account.</p>
        </div>
      </div>
    );
  }

  const { data: memberships } = await supabase
    .from('organization_members')
    .select('organization_id, role, organizations ( name )')
    .eq('person_id', person.id)
    .eq('status', 'active');

  const { data: records } = await supabase
    .from('compliance_records')
    .select('id, organization_id, type, status, verified_at')
    .eq('person_id', person.id);

  return (
    <div className="admin-page">
      <Nav />
      <div className="admin-header">
        <h1>My compliance status</h1>
      </div>
      <div className="admin-body">
        {(!memberships || memberships.length === 0) && (
          <p style={{ color: 'var(--gray)' }}>You're not a member of any organization yet.</p>
        )}

        {memberships?.map((m: any) => (
          <div key={m.organization_id} className="list-item-card">
            <h3>{m.organizations?.name}</h3>
            <ComplianceUploadForm
              personId={person.id}
              organizationId={m.organization_id}
              existingRecords={(records ?? []).filter((r) => r.organization_id === m.organization_id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
