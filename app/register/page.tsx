// app/register/page.tsx
//
// Public browse page — lists divisions open for registration, across all
// organizations. Relies on the 0003_public_registration_visibility.sql
// policies (organizations always public-readable; seasons/divisions
// readable when status = 'registration_open').

import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

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

  return (
    <div style={{ maxWidth: 640, margin: '60px auto', fontFamily: 'system-ui' }}>
      <h1>Register for a season</h1>

      {error && <p style={{ color: 'red' }}>Failed to load: {error.message}</p>}

      {!error && (!divisions || divisions.length === 0) && (
        <p style={{ color: '#666' }}>
          No divisions are currently open for registration. (If you're
          testing locally, run <code>supabase/seed_test_league.sql</code> in
          the Supabase SQL Editor first.)
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(divisions as unknown as OpenDivision[] | null)?.map((d) => (
          <Link
            key={d.id}
            href={`/register/${d.id}`}
            style={{
              display: 'block',
              padding: 16,
              border: '1px solid #ddd',
              borderRadius: 8,
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {d.season.organization.name} — {d.season.name}
            </div>
            <div>{d.name}</div>
            <div style={{ color: '#666', fontSize: 14 }}>
              {d.age_min && d.age_max ? `Ages ${d.age_min}–${d.age_max} · ` : ''}
              ${(d.price_cents / 100).toFixed(2)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
