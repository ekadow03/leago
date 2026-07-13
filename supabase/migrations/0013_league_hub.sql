-- 0013_league_hub.sql
-- League hub: general content pages (ARCHITECTURE.md §6, "one stop shop
-- for all things league related"). Adds an about/contact profile to
-- organizations, and a simple announcements feed admins can publish.

alter table organizations add column description text;
alter table organizations add column contact_email text;
alter table organizations add column contact_phone text;

comment on column organizations.description is
  'Public "about us" blurb shown on the league hub page.';

create table announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table announcements is
  'Simple news/announcements feed for the public league hub page. Same
  draft/published pattern as seasons and events elsewhere in this schema.';

create index announcements_org_idx on announcements(organization_id);

create trigger announcements_updated_at
  before update on announcements
  for each row execute function set_updated_at();

alter table announcements enable row level security;

create policy "public can read published announcements"
  on announcements for select
  using (status = 'published');

create policy "org admins can manage announcements"
  on announcements for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());