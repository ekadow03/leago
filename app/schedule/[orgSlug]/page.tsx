// app/schedule/[orgSlug]/page.tsx
//
// Public — no auth required. Relies on the "public can read published
// events" RLS policy (0009_events_and_schedule.sql) plus organizations
// being publicly readable (0003_public_registration_visibility.sql).

import { createClient } from '@/lib/supabase/server';

export default async function PublicSchedulePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', orgSlug)
    .single();

  if (!org) {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'system-ui' }}>
        <p>League not found.</p>
      </div>
    );
  }

  const { data: events } = await supabase
    .from('events')
    .select(
      `
      id, type, title, location, start_time,
      home_team:teams!events_home_team_id_fkey ( name ),
      away_team:teams!events_away_team_id_fkey ( name )
    `
    )
    .eq('organization_id', org.id)
    .eq('status', 'published')
    .order('start_time', { ascending: true });

  const grouped = new Map<string, any[]>();
  (events ?? []).forEach((ev) => {
    const day = new Date(ev.start_time).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(ev);
  });

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>{org.name} — Schedule</h1>

      {(!events || events.length === 0) && (
        <p style={{ color: '#666' }}>No games or events have been published yet. Check back soon.</p>
      )}

      {Array.from(grouped.entries()).map(([day, dayEvents]) => (
        <div key={day} style={{ marginBottom: 24 }}>
          <h3 style={{ borderBottom: '1px solid #ddd', paddingBottom: 4 }}>{day}</h3>
          {dayEvents.map((ev: any) => (
            <div key={ev.id} style={{ padding: '8px 0' }}>
              <div style={{ fontWeight: 600 }}>
                {ev.type === 'game' && ev.home_team && ev.away_team
                  ? `${ev.home_team.name} vs ${ev.away_team.name}`
                  : ev.title}
              </div>
              <div style={{ fontSize: 14, color: '#666' }}>
                {new Date(ev.start_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                {ev.location && ` · ${ev.location}`}
                {' · '}
                <span style={{ textTransform: 'capitalize' }}>{ev.type.replace('_', ' ')}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}