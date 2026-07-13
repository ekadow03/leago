// app/admin/tournaments/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import TournamentsList from './tournaments-list';

export default async function AdminTournamentsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/admin/tournaments');
  }

  const memberships = await getCurrentUserMemberships();
  const adminOrgs = memberships.filter((m) => m.roles.includes('admin'));

  if (adminOrgs.length === 0) {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'system-ui' }}>
        <p style={{ color: '#666' }}>You're not an admin of any organization.</p>
      </div>
    );
  }

  const org = adminOrgs[0];

  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, slug, status, entry_fee_cents, start_date')
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false });

  return (
    <TournamentsList
      organizationId={org.organizationId}
      organizationName={org.organizationName}
      initialTournaments={tournaments ?? []}
    />
  );
}