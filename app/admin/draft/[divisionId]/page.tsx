// app/admin/draft/[divisionId]/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import DraftBoard from './draft-board';
import Nav from '@/components/nav';

export default async function DraftPage({
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
    redirect(`/login?next=/admin/draft/${divisionId}`);
  }

  const { data: division } = await supabase
    .from('divisions')
    .select('id, name, season_id, seasons ( id, name, organization_id )')
    .eq('id', divisionId)
    .single();

  if (!division) {
    return (
      <div className="admin-page">
        <Nav />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>Division not found.</p>
        </div>
      </div>
    );
  }

  const season = division.seasons as any;
  const organizationId = season.organization_id;

  const memberships = await getCurrentUserMemberships();
  const isAdmin = memberships.some(
    (m) => m.organizationId === organizationId && m.roles.includes('admin')
  );

  if (!isAdmin) {
    return (
      <div className="admin-page">
        <Nav />
        <div className="empty-state" style={{ marginTop: 80 }}>
          <p>You must be an organization admin to view this page.</p>
        </div>
      </div>
    );
  }

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, coach_person_id')
    .eq('division_id', divisionId);

  const { data: registrations } = await supabase
    .from('registrations')
    .select('id, person_id, team_id, people!registrations_person_id_fkey ( id, first_name, last_name )')
    .eq('season_id', division.season_id)
    .eq('registration_type', 'player')
    .eq('status', 'confirmed');

  const { data: evaluations } = await supabase
    .from('evaluations')
    .select('person_id, overall_rating, scores, notes')
    .eq('season_id', division.season_id);

  const { data: existingSession } = await supabase
    .from('draft_sessions')
    .select('id, status, team_order, current_pick_index, total_rounds')
    .eq('division_id', divisionId)
    .maybeSingle();

  let picks: any[] = [];
  if (existingSession) {
    const { data } = await supabase
      .from('draft_picks')
      .select('id, pick_number, team_id, person_id, picked_at')
      .eq('draft_session_id', existingSession.id)
      .order('pick_number', { ascending: true });
    picks = data ?? [];
  }

  return (
    <div className="admin-page">
      <Nav />
      <div className="admin-header">
        <h1>{division.name}</h1>
        <p>Live Draft</p>
      </div>
      <div className="admin-body">
        <DraftBoard
          organizationId={organizationId}
          seasonId={division.season_id}
          divisionId={divisionId}
          divisionName={division.name}
          teams={teams ?? []}
          registrations={(registrations as any) ?? []}
          evaluations={evaluations ?? []}
          existingSession={existingSession ?? null}
          initialPicks={picks}
        />
      </div>
    </div>
  );
}
