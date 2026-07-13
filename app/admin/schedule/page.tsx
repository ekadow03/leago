// app/admin/schedule/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import ScheduleBuilder from './schedule-builder';

export default async function AdminSchedulePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/admin/schedule');
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

  const { data: seasons } = await supabase
    .from('seasons')
    .select('id, name')
    .eq('organization_id', org.organizationId)
    .order('created_at', { ascending: false });

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, division_id, divisions ( name )')
    .in(
      'division_id',
      (
        await supabase.from('divisions').select('id').in('season_id', (seasons ?? []).map((s) => s.id))
      ).data?.map((d) => d.id) ?? []
    );

  const { data: events } = await supabase
    .from('events')
    .select('id, type, title, location, start_time, status, season_id, home_team_id, away_team_id')
    .eq('organization_id', org.organizationId)
    .order('start_time', { ascending: true });

  return (
    <ScheduleBuilder
      organizationId={org.organizationId}
      organizationName={org.organizationName}
      seasons={seasons ?? []}
      teams={(teams as any) ?? []}
      initialEvents={events ?? []}
    />
  );
}