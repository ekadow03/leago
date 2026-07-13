-- 0011_tournaments.sql
-- Phase 7: tournament hosting (ARCHITECTURE.md §8). Structurally separate
-- from regular-season registration: entrants may belong to a completely
-- different league and have no account on this platform at all, so
-- tournament_teams captures contact info directly rather than requiring
-- a `people`/auth relationship.

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  location text,
  start_date date,
  end_date date,
  entry_fee_cents int not null default 0,
  registration_open_at timestamptz,
  registration_close_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'registration_open', 'registration_closed', 'in_progress', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

comment on table tournaments is
  'A tournament hosted by one organization. Public visibility is gated by
  status (registration_open and later stages are public; draft is not) —
  same pattern as seasons.status=registration_open.';

create index tournaments_org_idx on tournaments(organization_id);

create trigger tournaments_updated_at
  before update on tournaments
  for each row execute function set_updated_at();

create table tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  team_name text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  is_external boolean not null default true,
  home_organization_id uuid references organizations(id) on delete set null,
  seed int,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'withdrawn')),
  amount_cents int not null default 0,
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'processing', 'paid', 'refunded', 'failed')),
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
);

comment on table tournament_teams is
  'No FK to people/auth — an external team''s "account" is just their
  contact info entered on a public form. This is deliberate: requiring a
  full platform signup to enter a tournament would be a real barrier for
  outside teams, and the original spec calls for a lightweight flow here.';

create index tournament_teams_tournament_idx on tournament_teams(tournament_id);
create index tournament_teams_payment_intent_idx on tournament_teams(stripe_payment_intent_id);

create table tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round int not null,
  match_number int not null,
  team1_id uuid references tournament_teams(id) on delete set null,
  team2_id uuid references tournament_teams(id) on delete set null,
  winner_team_id uuid references tournament_teams(id) on delete set null,
  score_team1 int,
  score_team2 int,
  scheduled_time timestamptz,
  location text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'complete')),
  unique (tournament_id, round, match_number)
);

comment on table tournament_matches is
  'Single-elimination bracket. Round 1 matches are seeded from
  tournament_teams; later rounds start with null team1_id/team2_id and get
  filled in as earlier-round winners are recorded (see advanceWinner in
  lib/actions/tournaments.ts).';

create index tournament_matches_tournament_idx on tournament_matches(tournament_id);

alter table tournaments enable row level security;
alter table tournament_teams enable row level security;
alter table tournament_matches enable row level security;

create policy "public can read open or in-progress tournaments"
  on tournaments for select
  using (status in ('registration_open', 'registration_closed', 'in_progress', 'complete'));

create policy "org admins can manage tournaments"
  on tournaments for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());

create policy "public can read teams on visible tournaments"
  on tournament_teams for select
  using (
    exists (
      select 1 from tournaments t
      where t.id = tournament_teams.tournament_id
        and t.status in ('registration_open', 'registration_closed', 'in_progress', 'complete')
    )
  );

create policy "org admins can manage tournament teams"
  on tournament_teams for all
  using (
    exists (
      select 1 from tournaments t
      where t.id = tournament_teams.tournament_id and is_org_admin(t.organization_id)
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from tournaments t
      where t.id = tournament_teams.tournament_id and is_org_admin(t.organization_id)
    )
    or is_platform_admin()
  );

create policy "public can read matches on visible tournaments"
  on tournament_matches for select
  using (
    exists (
      select 1 from tournaments t
      where t.id = tournament_matches.tournament_id
        and t.status in ('registration_open', 'registration_closed', 'in_progress', 'complete')
    )
  );

create policy "org admins can manage matches"
  on tournament_matches for all
  using (
    exists (
      select 1 from tournaments t
      where t.id = tournament_matches.tournament_id and is_org_admin(t.organization_id)
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from tournaments t
      where t.id = tournament_matches.tournament_id and is_org_admin(t.organization_id)
    )
    or is_platform_admin()
  );