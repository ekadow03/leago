// app/dashboard/page.tsx
//
// The "player registration" landing page for a logged-in family: their
// household (self + any children added as dependents — see
// lib/actions/household.ts), what each member is already registered for,
// and which open divisions across every league they could register for
// next. Mirrors app/register/page.tsx's cross-org browse (deliberately
// left as a public marketplace) but scoped to "what applies to MY family."

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Nav from '@/components/nav';
import DashboardClient from './dashboard-client';

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/dashboard');
  }

  const { data: selfPerson, error: selfPersonError } = await supabase
    .from('people')
    .select('id, first_name, last_name, dob')
    .eq('auth_user_id', user.id)
    .single();

  if (!selfPerson) {
    // The generic message on screen doesn't say why — log the real
    // Supabase/Postgrest error server-side (visible in Vercel's function
    // logs) so a missing-profile report can actually be diagnosed instead
    // of guessed at from screenshots.
    console.error('[dashboard] people lookup failed', {
      authUserId: user.id,
      email: user.email,
      error: selfPersonError,
    });
    return (
      <div>
        <Nav />
        <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
          <p style={{ color: '#B23A2E' }}>No profile found for your account. Contact support.</p>
        </div>
      </div>
    );
  }

  const { data: guardianRows } = await supabase
    .from('guardians')
    .select('dependent:people!guardians_dependent_person_id_fkey ( id, first_name, last_name, dob )')
    .eq('guardian_person_id', selfPerson.id);

  const dependents = (guardianRows ?? [])
    .map((row: any) => row.dependent)
    .filter(Boolean) as { id: string; first_name: string; last_name: string; dob: string | null }[];

  const household = [
    { ...selfPerson, isSelf: true },
    ...dependents.map((d) => ({ ...d, isSelf: false })),
  ];

  const personIds = household.map((p) => p.id);

  const { data: registrationRows } = await supabase
    .from('registrations')
    .select(
      `
      id, person_id, registration_type, status, payment_status, amount_cents,
      division:divisions ( id, name ),
      season:seasons ( id, name, organization:organizations ( id, name ) )
    `
    )
    .in('person_id', personIds)
    .order('created_at', { ascending: false });

  const { data: openDivisionRows } = await supabase
    .from('divisions')
    .select(
      `
      id, name, age_min, age_max, price_cents,
      season:seasons!inner (
        id, name, status, age_cutoff_date,
        organization:organizations!inner ( id, name )
      )
    `
    )
    .eq('season.status', 'registration_open');

  return (
    <div>
      <Nav />
      <div className="hero-band" style={{ paddingBottom: 56 }}>
        <p className="hero-eyebrow">Your household</p>
        <h1 className="hero-title">Registration dashboard</h1>
        <p className="hero-subtitle">
          Manage who&apos;s in your family, see what they&apos;re registered for, and sign up for what&apos;s open.
        </p>
      </div>
      <div className="page-body">
        <DashboardClient
          household={household as any}
          registrations={(registrationRows as any) ?? []}
          openDivisions={(openDivisionRows as any) ?? []}
        />
      </div>
    </div>
  );
}
