// app/register/[divisionId]/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import RegistrationForm from './registration-form';
import Nav from '@/components/nav';

export default async function RegisterForDivisionPage({
  params,
  searchParams,
}: {
  params: Promise<{ divisionId: string }>;
  searchParams: Promise<{ personId?: string }>;
}) {
  const { divisionId } = await params;
  const { personId: requestedPersonId } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/register/${divisionId}`);
  }

  const { data: division, error } = await supabase
    .from('divisions')
    .select(
      `
      id, name, age_min, age_max, price_cents,
      season:seasons!inner (
        id, name, age_cutoff_date,
        organization:organizations!inner ( id, name )
      )
    `
    )
    .eq('id', divisionId)
    .single();

  if (error || !division) {
    return (
      <div>
        <Nav />
        <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
          <p style={{ color: '#B23A2E' }}>
            This division isn't open for registration (it may have closed, or the link is invalid).
          </p>
        </div>
      </div>
    );
  }

  const { data: selfPerson } = await supabase
    .from('people')
    .select('id, first_name, last_name, dob')
    .eq('auth_user_id', user.id)
    .single();

  if (!selfPerson) {
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

  const initialPersonId =
    requestedPersonId && household.some((h) => h.id === requestedPersonId) ? requestedPersonId : selfPerson.id;

  const d = division as any;

  const { data: registrationSettings } = await supabase
    .from('registration_settings')
    .select(
      'require_waiver, waiver_text, require_birth_certificate, offer_jersey_size, jersey_sizes, offer_hat_size, hat_sizes, offer_jersey_number, offer_years_experience'
    )
    .eq('season_id', d.season.id)
    .maybeSingle();

  return (
    <div>
      <Nav />
      <div className="hero-band" style={{ paddingBottom: 56 }}>
        <p className="hero-eyebrow">{d.season.organization.name}</p>
        <h1 className="hero-title">{d.name}</h1>
        <p className="hero-subtitle">{d.season.name}</p>
      </div>
      <div className="page-body">
        <RegistrationForm
          divisionId={d.id}
          divisionName={d.name}
          ageMin={d.age_min}
          ageMax={d.age_max}
          ageCutoffDate={d.season.age_cutoff_date}
          seasonId={d.season.id}
          seasonName={d.season.name}
          organizationId={d.season.organization.id}
          organizationName={d.season.organization.name}
          priceCents={d.price_cents}
          household={household as any}
          initialPersonId={initialPersonId}
          registrationSettings={(registrationSettings as any) ?? null}
        />
      </div>
    </div>
  );
}
