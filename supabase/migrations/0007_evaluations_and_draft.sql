-- 0007_evaluations_and_draft.sql
-- Phase 4: player evaluation scoring + live snake-draft tool
-- (ARCHITECTURE.md §7). Realtime is enabled on draft_sessions and
-- draft_picks so every connected screen (admin, coaches, spectators) sees
-- picks land instantly without polling.

-- ============================================================================
-- EVALUATIONS  (private — admins/evaluators only, never visible to
-- players/parents; this is a coach-facing skill assessment, not a report card)
-- ============================================================================
create table evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  evaluator_person_id uuid not null references people(id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  overall_rating numeric,
  notes text,
  created_at timestamptz not null default now()
);

comment on table evaluations is
  'Skill assessments from player evaluation day. Private to org
  admins/evaluators — deliberately NOT readable by the player or their
  parent (avoids the awkwardness of a numeric rating being visible to
  families, same reasoning most leagues keep tryout scores internal).';

create index evaluations_season_idx on evaluations(season_id);
create index evaluations_person_idx on evaluations(person_id);

-- ============================================================================
-- DRAFT_SESSIONS  (one per division being drafted)
-- ============================================================================
create table draft_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  division_id uuid not null references divisions(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'live', 'paused', 'complete')),
  team_order uuid[] not null default '{}',
  current_pick_index int not null default 0,
  total_rounds int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (division_id)
);

comment on table draft_sessions is
  'One row per division draft. current_pick_index + team_order + total_rounds
  is enough to derive "whose pick is it" without storing per-round state.';

create index draft_sessions_org_idx on draft_sessions(organization_id);

create trigger draft_sessions_updated_at
  before update on draft_sessions
  for each row execute function set_updated_at();

-- ============================================================================
-- DRAFT_PICKS  (append-only log of picks made)
-- ============================================================================
create table draft_picks (
  id uuid primary key default gen_random_uuid(),
  draft_session_id uuid not null references draft_sessions(id) on delete cascade,
  pick_number int not null,
  team_id uuid not null references teams(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  picked_by_person_id uuid references people(id) on delete set null,
  picked_at timestamptz not null default now(),
  unique (draft_session_id, pick_number),
  unique (draft_session_id, person_id)
);

comment on table draft_picks is
  'Append-only log — the draft board UI derives current state by replaying
  these rather than mutating a single "current roster" blob, so the draft
  history is naturally auditable and undo-able (delete the last row).';

create index draft_picks_session_idx on draft_picks(draft_session_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table evaluations enable row level security;
alter table draft_sessions enable row level security;
alter table draft_picks enable row level security;

create policy "org admins can manage evaluations"
  on evaluations for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());

create policy "org members can read draft sessions"
  on draft_sessions for select
  using (is_org_member(organization_id) or is_platform_admin());

create policy "org admins can manage draft sessions"
  on draft_sessions for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());

create policy "org members can read draft picks"
  on draft_picks for select
  using (
    exists (
      select 1 from draft_sessions ds
      where ds.id = draft_picks.draft_session_id and is_org_member(ds.organization_id)
    )
    or is_platform_admin()
  );

create policy "org admins can make draft picks"
  on draft_picks for insert
  with check (
    exists (
      select 1 from draft_sessions ds
      where ds.id = draft_picks.draft_session_id and is_org_admin(ds.organization_id)
    )
    or is_platform_admin()
  );

create policy "org admins can undo draft picks"
  on draft_picks for delete
  using (
    exists (
      select 1 from draft_sessions ds
      where ds.id = draft_picks.draft_session_id and is_org_admin(ds.organization_id)
    )
    or is_platform_admin()
  );

-- ============================================================================
-- REALTIME — broadcast changes on these two tables to subscribed clients.
-- Realtime respects RLS: a connected client only receives events for rows
-- their own SELECT policy would allow them to see, so this doesn't leak
-- draft state across organizations.
-- ============================================================================
alter publication supabase_realtime add table draft_sessions;
alter publication supabase_realtime add table draft_picks;