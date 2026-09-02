-- ============================================================================
-- DELEGATED PERMISSIONS
-- ============================================================================
-- Until now, every privileged action in the app has been gated on a single
-- binary: organization_members.role = 'admin' (checked via is_org_admin()).
-- That means the only way to let a board member/volunteer coordinator run
-- registrations, or run the draft, or handle scheduling, is to make them a
-- full admin — with access to everything, including org settings and
-- billing. This migration adds a real delegation layer: an admin can grant
-- a specific person one or more named permissions, each scoped to one
-- functional area of the app, without making them an admin.
--
-- Design mirrors is_org_member()/is_org_admin() from 0001_foundation.sql:
-- has_org_permission() is a `security definer` + `stable` SQL function, so
-- it can be called from any RLS policy (including ones on `people`, which
-- 0021 just fixed a recursion bug on) without re-triggering RLS on the
-- tables it queries internally.
--
-- Org admins implicitly have every permission — has_org_permission() checks
-- is_org_admin() first — so an admin never needs a row in this table.
--
-- Deliberately EXCLUDED from delegation (stay is_org_admin()-only, no
-- has_org_permission() bypass added anywhere in this migration):
--   - updating the organization row itself (identity/settings)
--   - "org admins can manage membership" (assigning roles, incl. admin —
--     if this were delegable, a delegate could grant themselves admin)
--   - platform_subscriptions (the org's own billing with leago)
-- Granting/revoking permissions themselves is also admin-only (see the
-- policy on organization_permissions below) for the same escalation
-- reason.

create table organization_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  permission text not null check (permission in (
    'manage_members',        -- view/edit member people rows (not role/permission assignment itself)
    'manage_divisions',      -- seasons, divisions, teams
    'manage_registrations',  -- registrations, refunds, registration_settings
    'manage_compliance',     -- documents, compliance_records, uploaded files
    'manage_evaluations',    -- evaluations
    'manage_draft',          -- draft_sessions, draft_picks
    'manage_schedule',       -- events, fields, blackouts, field_priorities, schedule_generation_settings
    'manage_volunteers',     -- volunteer_shifts, volunteer_signups
    'manage_tournaments',    -- tournaments, tournament_teams, tournament_matches
    'manage_communications'  -- announcements / league hub content
  )),
  granted_by_person_id uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, person_id, permission)
);

comment on table organization_permissions is
  'Delegated task-specific permissions for non-admin org members (board
  members/managers) — e.g. a registration coordinator granted
  manage_registrations without being a full admin. Org admins implicitly
  have every permission and never need a row here. Granting admin itself,
  or granting/revoking rows in this table, stays admin-only regardless —
  see has_org_permission() and this table''s own RLS policy.';

create index organization_permissions_org_idx on organization_permissions(organization_id);
create index organization_permissions_person_idx on organization_permissions(person_id);

alter table organization_permissions enable row level security;

create policy "org members can read permissions in their org"
  on organization_permissions for select
  using (is_org_member(organization_id) or is_platform_admin());

create policy "org admins can manage permissions"
  on organization_permissions for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());

-- Does the current auth user have this specific delegated permission in
-- this org — or are they an admin (who implicitly has all of them)?
create or replace function has_org_permission(org_id uuid, perm text)
returns boolean
language sql
security definer
stable
as $$
  select
    is_org_admin(org_id)
    or exists (
      select 1
      from organization_permissions op
      join people p on p.id = op.person_id
      where op.organization_id = org_id
        and op.permission = perm
        and p.auth_user_id = auth.uid()
    );
$$;

comment on function has_org_permission(uuid, text) is
  'True if the current auth user is an admin of org_id, OR has been
  granted the named delegated permission there. Use this (not
  is_org_admin directly) everywhere a task should be delegable to a
  non-admin board member/manager.';

-- ============================================================================
-- people — manage_members
-- ============================================================================
drop policy if exists "org admins can read member people" on people;
create policy "org admins can read member people"
  on people for select
  using (
    exists (
      select 1 from organization_members om
      where om.person_id = people.id
        and (is_org_admin(om.organization_id) or has_org_permission(om.organization_id, 'manage_members'))
    )
    or is_platform_admin()
  );

drop policy if exists "org admins can update member people" on people;
create policy "org admins can update member people"
  on people for update
  using (
    exists (
      select 1 from organization_members om
      where om.person_id = people.id
        and (is_org_admin(om.organization_id) or has_org_permission(om.organization_id, 'manage_members'))
    )
    or is_platform_admin()
  );

-- ============================================================================
-- seasons / divisions / teams — manage_divisions
-- ============================================================================
drop policy if exists "org admins can manage seasons" on seasons;
create policy "org admins can manage seasons"
  on seasons for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_divisions') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_divisions') or is_platform_admin());

drop policy if exists "org admins can manage divisions" on divisions;
create policy "org admins can manage divisions"
  on divisions for all
  using (
    exists (
      select 1 from seasons s
      where s.id = divisions.season_id
        and (is_org_admin(s.organization_id) or has_org_permission(s.organization_id, 'manage_divisions'))
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from seasons s
      where s.id = divisions.season_id
        and (is_org_admin(s.organization_id) or has_org_permission(s.organization_id, 'manage_divisions'))
    )
    or is_platform_admin()
  );

drop policy if exists "org admins can manage teams" on teams;
create policy "org admins can manage teams"
  on teams for all
  using (
    exists (
      select 1 from divisions d
      join seasons s on s.id = d.season_id
      where d.id = teams.division_id
        and (is_org_admin(s.organization_id) or has_org_permission(s.organization_id, 'manage_divisions'))
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from divisions d
      join seasons s on s.id = d.season_id
      where d.id = teams.division_id
        and (is_org_admin(s.organization_id) or has_org_permission(s.organization_id, 'manage_divisions'))
    )
    or is_platform_admin()
  );

-- ============================================================================
-- registrations / refunds / registration_settings — manage_registrations
-- ============================================================================
drop policy if exists "org admins can manage registrations" on registrations;
create policy "org admins can manage registrations"
  on registrations for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_registrations') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_registrations') or is_platform_admin());

drop policy if exists "org admins can manage refunds" on refunds;
create policy "org admins can manage refunds"
  on refunds for all
  using (
    exists (
      select 1 from registrations r
      where r.id = refunds.registration_id
        and (is_org_admin(r.organization_id) or has_org_permission(r.organization_id, 'manage_registrations'))
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from registrations r
      where r.id = refunds.registration_id
        and (is_org_admin(r.organization_id) or has_org_permission(r.organization_id, 'manage_registrations'))
    )
    or is_platform_admin()
  );

drop policy if exists "org admins can manage registration settings" on registration_settings;
create policy "org admins can manage registration settings"
  on registration_settings for all
  using (
    exists (
      select 1 from seasons s
      where s.id = registration_settings.season_id
        and (is_org_admin(s.organization_id) or has_org_permission(s.organization_id, 'manage_registrations'))
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from seasons s
      where s.id = registration_settings.season_id
        and (is_org_admin(s.organization_id) or has_org_permission(s.organization_id, 'manage_registrations'))
    )
    or is_platform_admin()
  );

drop policy if exists "org admins can read registration files" on storage.objects;
create policy "org admins can read registration files"
  on storage.objects for select
  using (
    bucket_id = 'compliance-documents'
    and exists (
      select 1 from registrations r
      where r.birth_certificate_path = storage.objects.name
        and (
          is_org_admin(r.organization_id)
          or has_org_permission(r.organization_id, 'manage_registrations')
          or has_org_permission(r.organization_id, 'manage_compliance')
        )
    )
  );

-- ============================================================================
-- documents / compliance_records / storage — manage_compliance
-- ============================================================================
drop policy if exists "org admins can read linked documents" on documents;
create policy "org admins can read linked documents"
  on documents for select
  using (
    exists (
      select 1 from compliance_records cr
      where cr.document_id = documents.id
        and (is_org_admin(cr.organization_id) or has_org_permission(cr.organization_id, 'manage_compliance'))
    )
    or is_platform_admin()
  );

drop policy if exists "org admins can manage compliance records" on compliance_records;
create policy "org admins can manage compliance records"
  on compliance_records for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_compliance') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_compliance') or is_platform_admin());

drop policy if exists "org admins can read linked files" on storage.objects;
create policy "org admins can read linked files"
  on storage.objects for select
  using (
    bucket_id = 'compliance-documents'
    and exists (
      select 1 from documents d
      join compliance_records cr on cr.document_id = d.id
      where d.storage_path = storage.objects.name
        and (is_org_admin(cr.organization_id) or has_org_permission(cr.organization_id, 'manage_compliance'))
    )
  );

-- ============================================================================
-- evaluations — manage_evaluations
-- ============================================================================
drop policy if exists "org admins can manage evaluations" on evaluations;
create policy "org admins can manage evaluations"
  on evaluations for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_evaluations') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_evaluations') or is_platform_admin());

-- ============================================================================
-- draft_sessions / draft_picks — manage_draft
-- ============================================================================
drop policy if exists "org admins can manage draft sessions" on draft_sessions;
create policy "org admins can manage draft sessions"
  on draft_sessions for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_draft') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_draft') or is_platform_admin());

drop policy if exists "org admins can make draft picks" on draft_picks;
create policy "org admins can make draft picks"
  on draft_picks for insert
  with check (
    exists (
      select 1 from draft_sessions ds
      where ds.id = draft_picks.draft_session_id
        and (is_org_admin(ds.organization_id) or has_org_permission(ds.organization_id, 'manage_draft'))
    )
    or is_platform_admin()
  );

drop policy if exists "org admins can undo draft picks" on draft_picks;
create policy "org admins can undo draft picks"
  on draft_picks for delete
  using (
    exists (
      select 1 from draft_sessions ds
      where ds.id = draft_picks.draft_session_id
        and (is_org_admin(ds.organization_id) or has_org_permission(ds.organization_id, 'manage_draft'))
    )
    or is_platform_admin()
  );

-- ============================================================================
-- events / fields / blackouts / field_priorities / schedule_generation_settings
-- — manage_schedule
-- ============================================================================
drop policy if exists "org admins can manage events" on events;
create policy "org admins can manage events"
  on events for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_schedule') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_schedule') or is_platform_admin());

drop policy if exists "org admins can manage fields" on fields;
create policy "org admins can manage fields"
  on fields for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_schedule') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_schedule') or is_platform_admin());

drop policy if exists "org admins can manage blackouts" on blackouts;
create policy "org admins can manage blackouts"
  on blackouts for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_schedule') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_schedule') or is_platform_admin());

drop policy if exists "org admins can manage field priorities" on field_priorities;
create policy "org admins can manage field priorities"
  on field_priorities for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_schedule') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_schedule') or is_platform_admin());

drop policy if exists "org admins can manage schedule generation settings" on schedule_generation_settings;
create policy "org admins can manage schedule generation settings"
  on schedule_generation_settings for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_schedule') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_schedule') or is_platform_admin());

-- ============================================================================
-- volunteer_shifts / volunteer_signups — manage_volunteers
-- ============================================================================
drop policy if exists "org admins can manage shifts" on volunteer_shifts;
create policy "org admins can manage shifts"
  on volunteer_shifts for all
  using (
    exists (
      select 1 from events e
      where e.id = volunteer_shifts.event_id
        and (is_org_admin(e.organization_id) or has_org_permission(e.organization_id, 'manage_volunteers'))
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from events e
      where e.id = volunteer_shifts.event_id
        and (is_org_admin(e.organization_id) or has_org_permission(e.organization_id, 'manage_volunteers'))
    )
    or is_platform_admin()
  );

drop policy if exists "people can cancel their own signup" on volunteer_signups;
create policy "people can cancel their own signup"
  on volunteer_signups for delete
  using (
    exists (select 1 from people p where p.id = volunteer_signups.person_id and p.auth_user_id = auth.uid())
    or exists (
      select 1 from volunteer_shifts vs
      join events e on e.id = vs.event_id
      where vs.id = volunteer_signups.shift_id
        and (is_org_admin(e.organization_id) or has_org_permission(e.organization_id, 'manage_volunteers'))
    )
    or is_platform_admin()
  );

-- ============================================================================
-- tournaments / tournament_teams / tournament_matches — manage_tournaments
-- ============================================================================
drop policy if exists "org admins can manage tournaments" on tournaments;
create policy "org admins can manage tournaments"
  on tournaments for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_tournaments') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_tournaments') or is_platform_admin());

drop policy if exists "org admins can manage tournament teams" on tournament_teams;
create policy "org admins can manage tournament teams"
  on tournament_teams for all
  using (
    exists (
      select 1 from tournaments t
      where t.id = tournament_teams.tournament_id
        and (is_org_admin(t.organization_id) or has_org_permission(t.organization_id, 'manage_tournaments'))
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from tournaments t
      where t.id = tournament_teams.tournament_id
        and (is_org_admin(t.organization_id) or has_org_permission(t.organization_id, 'manage_tournaments'))
    )
    or is_platform_admin()
  );

drop policy if exists "org admins can manage matches" on tournament_matches;
create policy "org admins can manage matches"
  on tournament_matches for all
  using (
    exists (
      select 1 from tournaments t
      where t.id = tournament_matches.tournament_id
        and (is_org_admin(t.organization_id) or has_org_permission(t.organization_id, 'manage_tournaments'))
    )
    or is_platform_admin()
  )
  with check (
    exists (
      select 1 from tournaments t
      where t.id = tournament_matches.tournament_id
        and (is_org_admin(t.organization_id) or has_org_permission(t.organization_id, 'manage_tournaments'))
    )
    or is_platform_admin()
  );

-- ============================================================================
-- announcements — manage_communications
-- ============================================================================
drop policy if exists "org admins can manage announcements" on announcements;
create policy "org admins can manage announcements"
  on announcements for all
  using (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_communications') or is_platform_admin())
  with check (is_org_admin(organization_id) or has_org_permission(organization_id, 'manage_communications') or is_platform_admin());
