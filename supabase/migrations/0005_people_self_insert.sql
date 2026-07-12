-- 0005_people_self_insert.sql
-- Bug fix: 0001_foundation.sql defined SELECT and UPDATE policies for
-- `people` but never an INSERT policy. RLS denies by default when enabled
-- with no matching policy, so the sign-up flow's own insert into `people`
-- (lib/actions/auth.ts, signUp()) was silently blocked — auth users could
-- be created but never got a linked people row.

create policy "people can insert own row"
  on people for insert
  with check (auth_user_id = auth.uid());

comment on policy "people can insert own row" on people is
  'Lets a newly authenticated user create their own linked people row '
  'during sign-up. Without this, signUp() in lib/actions/auth.ts fails '
  'silently on the people insert step.';
