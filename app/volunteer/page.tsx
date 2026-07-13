// app/volunteer/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import VolunteerList from './volunteer-list';
import Nav from '@/components/nav';

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
      <div className="admin-page">
        <Nav />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>No profile found for your account.</p>
        </div>
      </div>
    );
  }

  const memberships = await getCurrentUserMemberships();

  if (memberships.length === 0) {
    return (
      <div className="admin-page">
        <Nav />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>You're not a member of any organization yet.</p>
        </div>
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
    ? await supabase.from('volunteer_shifts').select('id, event_id, role, slots_total, notes').in('event_id', eventIds)
    : { data: [] };

  const shiftIds = (shifts ?? []).map((s) => s.id);

  const { data: signups } = shiftIds.length
    ? await supabase.from('volunteer_signups').select('id, shift_id, person_id, people ( first_name, last_name )').in('shift_id', shiftIds)
    : { data: [] };

  return (
    <div className="admin-page">
      <Nav />
      <div className="admin-header">
        <h1>Volunteer</h1>
        <p>{org.organizationName}</p>
      </div>
      <div className="admin-body">
        <VolunteerList
          organizationId={org.organizationId}
          organizationName={org.organizationName}
          isAdmin={isAdmin}
          currentPersonId={person.id}
          events={events ?? []}
          shifts={shifts ?? []}
          signups={(signups as any) ?? []}
        />
      </div>
    </div>
  );
}
