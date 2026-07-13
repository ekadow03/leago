// app/compliance/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ComplianceUploadForm from './compliance-upload-form';

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
      <div style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'system-ui' }}>
        <p style={{ color: 'red' }}>No profile found for your account.</p>
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
    <div style={{ maxWidth: 600, margin: '40px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>My compliance status</h1>

      {(!memberships || memberships.length === 0) && (
        <p style={{ color: '#666' }}>
          You're not a member of any organization yet, so there's nothing to
          track here.
        </p>
      )}

      {memberships?.map((m: any) => (
        <div key={m.organization_id} style={{ marginBottom: 32, border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>{m.organizations?.name}</h2>

          <ComplianceUploadForm
            personId={person.id}
            organizationId={m.organization_id}
            existingRecords={
              (records ?? []).filter((r) => r.organization_id === m.organization_id)
            }
          />
        </div>
      ))}
    </div>
  );
}