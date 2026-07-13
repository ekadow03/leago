// app/volunteer/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import VolunteerList from './volunteer-list';

export default async function VolunteerPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/volunteer');
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

  const memberships = await getCurrentUserMemberships();

  if (memberships.length === 0) {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'system-ui' }}>
        <p style={{ color: '#666' }}>You're not a member of any organization yet.</p>
      </div>
    );
  }

  const org = memberships[0];
  const isAdmin = org.roles.includes('admin');

  const { data: events } = await supabase
    .from('events')
    .select('id, title, type, start_time, status')
    .eq('organization_id', org.organizationId)
    .order('start_time', { ascending: true });

  const eventIds = (events ?? []).map((e) => e.id);

  const { data: shifts } = eventIds.length
    ? await supabase
        .from('volunteer_shifts')
        .select('id, event_id, role, slots_total, notes')
        .in('event_id', eventIds)
    : { data: [] };

  const shiftIds = (shifts ?? []).map((s) => s.id);

  const { data: signups } = shiftIds.length
    ? await supabase
        .from('volunteer_signups')
        .select('id, shift_id, person_id, people ( first_name, last_name )')
        .in('shift_id', shiftIds)
    : { data: [] };

  return (
    <VolunteerList
      organizationId={org.organizationId}
      organizationName={org.organizationName}
      isAdmin={isAdmin}
      currentPersonId={person.id}
      events={events ?? []}
      shifts={shifts ?? []}
      signups={(signups as any) ?? []}
    />
  );
}