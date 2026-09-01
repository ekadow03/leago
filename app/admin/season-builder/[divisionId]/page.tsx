// app/admin/season-builder/[divisionId]/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserMemberships } from '@/lib/org-context';
import { redirect } from 'next/navigation';
import SeasonBuilder from './season-builder';
import Link from 'next/link';
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

  const { data: existingGameRows } = await supabase
    .from('events')
    .select('status')
    .eq('division_id', divisionId)
    .eq('type', 'game');

  const draftGameCount = (existingGameRows ?? []).filter((r) => r.status === 'draft').length;
  const publishedGameCount = (existingGameRows ?? []).filter((r) => r.status === 'published').length;

  const { data: orgFields } = await supabase
    .from('fields')
    .select('id, name')
    .eq('organization_id', organizationId)
    .order('name', { ascending: true });

  // Blackouts are season-scoped (shared across every division in the
  // season, not just this one) but managed here in the schedule builder,
  // right alongside the slots/dates they actually constrain.
  const { data: blackouts } = await supabase
    .from('blackouts')
    .select('id, season_id, field_name, kind, blackout_date, day_of_week, start_time, end_time, label')
    .eq('season_id', division.season_id);

  // This division's field priority ranking (migration 0018), lowest
  // number (highest priority) first — used only to pre-fill the field
  // list below so it doesn't need re-picking every generation; the
  // actual reservation enforcement happens server-side inside
  // generateSeasonSchedule() itself.
  const { data: fieldPriorities } = await supabase
    .from('field_priorities')
    .select('priority, fields ( name )')
    .eq('division_id', divisionId)
    .order('priority', { ascending: true });

  const initialFieldNames = ((fieldPriorities ?? []) as unknown as { priority: number; fields: { name: string } | null }[])
    .map((row) => row.fields?.name)
    .filter((name): name is string => !!name);

  // Last-used generation inputs for this division (migration 0019), if
  // it's been generated before — restored into the form below so
  // regenerating with today's teams/blackouts/priorities doesn't mean
  // re-entering every day/time/field slot from scratch.
  const { data: savedSettings } = await supabase
    .from('schedule_generation_settings')
    .select('day_slots, games_per_team, game_duration_minutes, start_date, end_date')
    .eq('division_id', divisionId)
    .maybeSingle();

  return (
    <div className="admin-page">
      <Nav />
      <div className="admin-header">
        <Link href="/admin" style={{ fontSize: 13, color: 'var(--gray)' }}>
          ← Back to admin
        </Link>
        <h1>{division.name}</h1>
        <p>{season.name} · Schedule</p>
      </div>
      <div className="admin-body">
        <SeasonBuilder
          organizationId={organizationId}
          seasonId={division.season_id}
          divisionId={divisionId}
          divisionName={division.name}
          initialTeams={teams ?? []}
          draftGameCount={draftGameCount}
          publishedGameCount={publishedGameCount}
          orgFields={orgFields ?? []}
          initialBlackouts={(blackouts as any) ?? []}
          initialFieldNames={initialFieldNames}
          initialSettings={(savedSettings as any) ?? null}
        />
      </div>
    </div>
  );
}
