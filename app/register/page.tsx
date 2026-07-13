// app/register/page.tsx
//
// Public browse page — lists divisions open for registration. Relies on
// the "public can read open-registration seasons" RLS policies.

import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import Nav from '@/components/nav';

interface OpenDivision {
  id: string;
  name: string;
  age_min: number | null;
  age_max: number | null;
  price_cents: number;
  season: {
    id: string;
    name: string;
    organization: {
      id: string;
      name: string;
    };
  };
}

export default async function RegisterBrowsePage() {
  const supabase = await createClient();

  const { data: divisions, error } = await supabase
    .from('divisions')
    .select(
      `
      id, name, age_min, age_max, price_cents,
      season:seasons!inner (
        id, name, status,
        organization:organizations!inner ( id, name )
      )
    `
    )
    .eq('season.status', 'registration_open');

  const openDivisions = divisions as unknown as OpenDivision[] | null;

  return (
    <div>
      <Nav />

      <div className="hero-band">
        <p className="hero-eyebrow">Registration is open</p>
        <h1 className="hero-title">
          Find your <span className="accent">season</span>
        </h1>
        <p className="hero-subtitle">
          Browse divisions across every league on leago and sign up in a couple of minutes.
        </p>
      </div>

      {error && (
        <p style={{ textAlign: 'center', color: '#B23A2E', padding: 24 }}>
          Failed to load: {error.message}
        </p>
      )}

      {!error && (!openDivisions || openDivisions.length === 0) && (
        <div className="empty-state">
          <p>No divisions are open for registration right now. Check back soon.</p>
        </div>
      )}

      <div className="card-grid">
        {openDivisions?.map((d) => (
          <Link key={d.id} href={`/register/${d.id}`} className="card">
            <p className="card-eyebrow">{d.season.organization.name}</p>
            <h2 className="card-title">{d.name}</h2>
            <p className="card-meta">
              {d.season.name}
              {d.age_min && d.age_max ? ` · Ages ${d.age_min}–${d.age_max}` : ''}
            </p>
            <div className="card-footer">
              <span className="card-price">${(d.price_cents / 100).toFixed(0)}</span>
              <span className="card-cta">Register →</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}