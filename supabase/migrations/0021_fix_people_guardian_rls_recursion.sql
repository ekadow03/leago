-- ============================================================================
-- FIX: infinite recursion in the guardian RLS policies added in 0020
-- ============================================================================
-- 0020 added three policies that do a raw subquery directly against
-- `people` or `guardians` from within a policy defined ON one of those
-- same tables:
--
--   "guardians can manage own relationships" (on guardians) queries people
--   "guardians can read dependent people rows" (on people) queries guardians, which queries people
--   "guardians can update dependent people rows" (on people) queries guardians, which queries people
--
-- Evaluating "people" RLS therefore requires evaluating "guardians" RLS,
-- which requires evaluating "people" RLS again — Postgres detects this
-- and fails every query against `people` with:
--   42P17 infinite recursion detected in policy for relation "people"
--
-- This is exactly what 0001_foundation.sql's is_org_member()/is_org_admin()
-- helpers were designed to avoid: a `security definer` + `stable` SQL
-- function runs with the privileges of its owner (bypassing RLS on the
-- tables it queries internally), so calling it from a policy never
-- re-triggers that policy's own table's RLS. 0020's guardian policies
-- didn't use that pattern — this migration fixes them to.

drop policy if exists "guardians can manage own relationships" on guardians;
drop policy if exists "guardians can read dependent people rows" on people;
drop policy if exists "guardians can update dependent people rows" on people;

-- Is the current auth user the person identified by person_id?
-- (Equivalent to `auth_user_id = auth.uid()` but usable from a policy on
-- another table — or on people itself — without recursing back into
-- people's own RLS.)
create or replace function is_self_person(person_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from people p
    where p.id = person_id and p.auth_user_id = auth.uid()
  );
$$;

-- Is the current auth user a guardian of this person (i.e. dependent_id
-- is one of their household members in the guardians table)?
create or replace function is_guardian_of(dependent_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from guardians g
    join people gp on gp.id = g.guardian_person_id
    where g.dependent_person_id = dependent_id
      and gp.auth_user_id = auth.uid()
  );
$$;

create policy "guardians can manage own relationships"
  on guardians for all
  using (is_self_person(guardians.guardian_person_id) or is_platform_admin())
  with check (is_self_person(guardians.guardian_person_id) or is_platform_admin());

create policy "guardians can read dependent people rows"
  on people for select
  using (is_guardian_of(people.id));

create policy "guardians can update dependent people rows"
  on people for update
  using (is_guardian_of(people.id));
