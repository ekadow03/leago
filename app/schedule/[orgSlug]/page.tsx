// app/schedule/[orgSlug]/page.tsx
//
// Public — no auth required. Relies on the "public can read published
// events" RLS policy plus organizations being publicly readable.

import { createClient } from '@/lib/supabase/server';
import Nav from '@/components/nav';

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
      <div>
        <Nav />
        <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
          <p>League not found.</p>
        </div>
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
    <div>
      <Nav />
      <div className="hero-band" style={{ paddingBottom: 56 }}>
        <p className="hero-eyebrow">{org.name}</p>
        <h1 className="hero-title">
          Season <span className="accent">schedule</span>
        </h1>
      </div>

      <div className="schedule-body">
        {(!events || events.length === 0) && (
          <div className="empty-state">
            <p>No games or events have been published yet. Check back soon.</p>
          </div>
        )}

        {Array.from(grouped.entries()).map(([day, dayEvents]) => (
          <div key={day} className="schedule-day">
            <h3>{day}</h3>
            {dayEvents.map((ev: any) => (
              <div key={ev.id} className="schedule-event">
                <div className="schedule-event-title">
                  {ev.type === 'game' && ev.home_team && ev.away_team
                    ? `${ev.home_team.name} vs ${ev.away_team.name}`
                    : ev.title}
                  <span className="event-badge">{ev.type.replace('_', ' ')}</span>
                </div>
                <div className="schedule-event-meta">
                  {new Date(ev.start_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  {ev.location && ` · ${ev.location}`}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}