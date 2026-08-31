// app/admin/season-builder/[divisionId]/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import SeasonBuilder from './season-builder';
import Nav from '@/components/nav';

export default async function SeasonBuilderPage({
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
    redirect(`/login?next=/admin/season-builder/${divisionId}`);
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
    .select('id, name')
    .eq('division_id', divisionId)
    .order('name', { ascending: true });

  const { data: existingGames } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('division_id', divisionId)
    .eq('type', 'game');

  return (
    <div className="admin-page">
      <Nav />
      <div className="admin-header">
        <h1>{division.name}</h1>
        <p>{season.name} · Season builder</p>
      </div>
      <div className="admin-body">
        <SeasonBuilder
          organizationId={organizationId}
          seasonId={division.season_id}
          divisionId={divisionId}
          divisionName={division.name}
          initialTeams={teams ?? []}
          existingGameCount={(existingGames as any)?.count ?? 0}
        />
      </div>
    </div>
  );
}
