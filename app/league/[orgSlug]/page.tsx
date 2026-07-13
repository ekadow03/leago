// app/league/[orgSlug]/page.tsx
//
// Public — the "one stop shop" for a league: about info, contact details,
// announcements, and quick links to registration/schedule/tournaments.

import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import BrandedNav from '@/components/branded-nav';

export default async function LeagueHubPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, description, contact_email, contact_phone, branding_theme')
    .eq('slug', orgSlug)
    .single();

  if (!org) {
    return (
      <div>
        <BrandedNav organizationName="leago" />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>League not found.</p>
        </div>
      </div>
    );
  }

  const branding = org.branding_theme as any;

  const { data: announcements } = await supabase
    .from('announcements')
    .select('id, title, body, created_at')
    .eq('organization_id', org.id)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, slug, status')
    .eq('organization_id', org.id)
    .in('status', ['registration_open', 'in_progress'])
    .limit(3);

  return (
    <div>
      <BrandedNav organizationName={org.name} branding={branding} />
      <div className="hero-band" style={{ background: branding?.primaryColor || undefined }}>
        <h1 className="hero-title">{org.name}</h1>
        {org.description && <p className="hero-subtitle">{org.description}</p>}
      </div>

      <div className="schedule-body">
        <div className="card-grid" style={{ margin: '0 0 32px', maxWidth: 'none', padding: 0 }}>
          <Link href="/register" className="card">
            <h2 className="card-title">Register</h2>
            <p className="card-meta">Sign up for the current season</p>
            <div className="card-footer" style={{ border: 'none', paddingTop: 0 }}>
              <span className="card-cta">Go →</span>
            </div>
          </Link>
          <Link href={`/schedule/${orgSlug}`} className="card">
            <h2 className="card-title">Schedule</h2>
            <p className="card-meta">Games, practices, and events</p>
            <div className="card-footer" style={{ border: 'none', paddingTop: 0 }}>
              <span className="card-cta">Go →</span>
            </div>
          </Link>
          <Link href="/volunteer" className="card">
            <h2 className="card-title">Volunteer</h2>
            <p className="card-meta">Sign up for a shift</p>
            <div className="card-footer" style={{ border: 'none', paddingTop: 0 }}>
              <span className="card-cta">Go →</span>
            </div>
          </Link>
        </div>

        {tournaments && tournaments.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontWeight: 800 }}>Tournaments</h2>
            {tournaments.map((t) => (
              <Link
                key={t.id}
                href={`/tournaments/${t.slug}`}
                className="schedule-day"
                style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
              >
                <div className="schedule-event-title">{t.name}</div>
                <div className="schedule-event-meta">{t.status.replace('_', ' ')}</div>
              </Link>
            ))}
          </div>
        )}

        {(org.contact_email || org.contact_phone) && (
          <div className="list-item-card">
            <h3>Contact</h3>
            {org.contact_email && <p style={{ margin: '4px 0' }}>{org.contact_email}</p>}
            {org.contact_phone && <p style={{ margin: '4px 0' }}>{org.contact_phone}</p>}
          </div>
        )}

        {announcements && announcements.length > 0 && (
          <div>
            <h2 style={{ fontWeight: 800 }}>Announcements</h2>
            {announcements.map((a) => (
              <div key={a.id} className="schedule-day">
                <h3 style={{ color: 'var(--navy)' }}>{a.title}</h3>
                <p style={{ fontSize: 14, color: 'var(--gray)', margin: 0 }}>{a.body}</p>
                <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 8, marginBottom: 0 }}>
                  {new Date(a.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}