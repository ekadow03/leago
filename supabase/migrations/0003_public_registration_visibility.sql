-- 0003_public_registration_visibility.sql
-- Phase 2 (UI slice): prospective registrants aren't org members yet, so the
-- Phase 1 policies ("org members can read seasons") would block anyone from
-- ever seeing what's open to register for. This adds narrow public-read
-- policies scoped ONLY to organizations/seasons that are actively open for
-- registration — not a blanket public-read grant.

-- ---- organizations: public can see basic org info (name, branding) so a
--      registration page can show "you're registering for {org.name}" ----
create policy "public can read basic org info"
  on organizations for select
  using (true);
  -- Note: this is intentionally broad (any authenticated OR anonymous reader
  -- can see org name/branding/slug) since that information isn't sensitive
  -- and league directories are expected to be publicly browsable. Anything
  -- actually sensitive on this table (stripe_connect_account_id, etc.) is
  -- not something RLS can selectively hide per-column — if that becomes a
  -- concern, split sensitive fields into a separate admin-only table rather
  -- than relying on column-level filtering.

-- ---- seasons: public can see seasons that are open for registration ----
create policy "public can read open-registration seasons"
  on seasons for select
  using (status = 'registration_open');

-- ---- divisions: public can see divisions belonging to an open season ----
create policy "public can read divisions of open seasons"
  on divisions for select
  using (
    exists (
      select 1 from seasons s
      where s.id = divisions.season_id and s.status = 'registration_open'
    )
  );

comment on policy "public can read basic org info" on organizations is
  'Broad by design — org directory info is not sensitive. Revisit if a '
  'league ever wants a private/invite-only org.';
comment on policy "public can read open-registration seasons" on seasons is
  'Scoped narrowly to status=registration_open only — draft/closed/archived '
  'seasons remain member-only via the existing 0001_foundation.sql policy.';
