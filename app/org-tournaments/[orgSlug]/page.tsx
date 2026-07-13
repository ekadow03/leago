// app/org-tournaments/[orgSlug]/page.tsx
//
// Public — this is what a visitor to acmetourneys.leago.com sees at the
// root path (see proxy.ts, which rewrites subdomain root requests here).
// [orgSlug] is actually the org's SUBDOMAIN value, not its slug — named
// orgSlug for readability, but looked up against organizations.subdomain.

import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import BrandedNav from '@/components/branded-nav';

export default async function OrgTournamentsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, branding_theme')
    .eq('subdomain', orgSlug)
    .single();

  if (!org) {
    return (
      <div>
        <BrandedNav organizationName="leago" />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>This page isn't set up yet.</p>
        </div>
      </div>
    );
  }

  const branding = org.branding_theme as any;

  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, slug, status, entry_fee_cents, start_date, location')
    .eq('organization_id', org.id)
    .in('status', ['registration_open', 'registration_closed', 'in_progress', 'complete'])
    .order('start_date', { ascending: true });

  return (
    <div>
      <BrandedNav organizationName={org.name} branding={branding} />
      <div className="hero-band" style={{ background: branding?.primaryColor || undefined }}>
        <p className="hero-eyebrow">Tournaments</p>
        <h1 className="hero-title">{org.name}</h1>
        <p className="hero-subtitle">Browse and register for upcoming tournaments.</p>
      </div>

      <div className="card-grid">
        {(!tournaments || tournaments.length === 0) && (
          <div className="empty-state">
            <p>No tournaments are open right now. Check back soon.</p>
          </div>
        )}
        {tournaments?.map((t) => (
          <Link key={t.id} href={`/tournaments/${t.slug}`} className="card">
            <p className="card-eyebrow">{t.status.replace('_', ' ')}</p>
            <h2 className="card-title">{t.name}</h2>
            <p className="card-meta">
              {t.location}
              {t.start_date && ` · ${t.start_date}`}
            </p>
            <div className="card-footer">
              <span className="card-price">${(t.entry_fee_cents / 100).toFixed(0)}</span>
              <span className="card-cta">View →</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}