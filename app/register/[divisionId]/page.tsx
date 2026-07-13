// app/register/[divisionId]/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import RegistrationForm from './registration-form';
import Nav from '@/components/nav';

export default async function RegisterForDivisionPage({
  params,
}: {
  params: Promise<{ divisionId: string }>;
}) {
  const { divisionId } = await params;
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
        id, name,
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

  const { data: person } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!person) {
    return (
      <div>
        <Nav />
        <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
          <p style={{ color: '#B23A2E' }}>No profile found for your account. Contact support.</p>
        </div>
      </div>
    );
  }

  const d = division as any;

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
          seasonId={d.season.id}
          seasonName={d.season.name}
          organizationId={d.season.organization.id}
          organizationName={d.season.organization.name}
          priceCents={d.price_cents}
          personId={person.id}
        />
      </div>
    </div>
  );
}