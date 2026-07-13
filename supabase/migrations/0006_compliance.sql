-- 0006_compliance.sql
-- Phase 3: document upload + compliance tracking (ARCHITECTURE.md §5-6).
-- Scope for this migration: schema + storage only. Background-check vendor
-- integration (Sterling/Ankored) is a later migration once a vendor is
-- chosen — external_reference_id below is reserved for that.

-- ============================================================================
-- DOCUMENTS  (the uploaded files themselves)
-- ============================================================================
create table documents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  type text not null check (type in ('birth_certificate', 'coach_cert', 'other')),
  storage_path text not null,
  original_filename text,
  uploaded_by_person_id uuid references people(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

comment on table documents is
  'Uploaded compliance files (birth certificates, coach certifications). '
  'Private storage only — never a public bucket. Minors'' documents in '
  'particular must never be broadly readable; access is gated by RLS below '
  'plus short-lived signed URLs at read time, not by bucket-level public access.';

create index documents_person_idx on documents(person_id);

-- ============================================================================
-- COMPLIANCE_RECORDS  (status tracker — one row per person per requirement type)
-- ============================================================================
create table compliance_records (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  type text not null check (type in ('background_check', 'coach_cert', 'birth_certificate')),
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'verified', 'rejected', 'expired')),
  document_id uuid references documents(id) on delete set null,
  external_reference_id text,
  reviewed_by_person_id uuid references people(id) on delete set null,
  review_notes text,
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, organization_id, type)
);

comment on table compliance_records is
  'One row per person per org per requirement type. This is the status a '
  'league admin actually looks at — documents table holds the file, this '
  'table holds the verification decision.';

create index compliance_org_idx on compliance_records(organization_id);
create index compliance_person_idx on compliance_records(person_id);

create trigger compliance_records_updated_at
  before update on compliance_records
  for each row execute function set_updated_at();

-- ============================================================================
-- STORAGE BUCKET (private)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('compliance-documents', 'compliance-documents', false)
on conflict (id) do nothing;

-- ============================================================================
-- ROW LEVEL SECURITY — documents & compliance_records
-- ============================================================================
alter table documents enable row level security;
alter table compliance_records enable row level security;

-- ---- documents ----
create policy "people can read own documents"
  on documents for select
  using (
    exists (select 1 from people p where p.id = documents.person_id and p.auth_user_id = auth.uid())
    or is_platform_admin()
  );

create policy "org admins can read linked documents"
  on documents for select
  using (
    exists (
      select 1 from compliance_records cr
      where cr.document_id = documents.id and is_org_admin(cr.organization_id)
    )
    or is_platform_admin()
  );

-- ---- compliance_records ----
create policy "people can read own compliance records"
  on compliance_records for select
  using (
    exists (select 1 from people p where p.id = compliance_records.person_id and p.auth_user_id = auth.uid())
    or is_org_admin(organization_id)
    or is_platform_admin()
  );

create policy "org admins can manage compliance records"
  on compliance_records for all
  using (is_org_admin(organization_id) or is_platform_admin())
  with check (is_org_admin(organization_id) or is_platform_admin());

-- ============================================================================
-- ROW LEVEL SECURITY — storage.objects for the compliance-documents bucket
-- ============================================================================
create policy "people can read own uploaded files"
  on storage.objects for select
  using (
    bucket_id = 'compliance-documents'
    and exists (
      select 1 from documents d
      join people p on p.id = d.person_id
      where d.storage_path = storage.objects.name
        and p.auth_user_id = auth.uid()
    )
  );

create policy "org admins can read linked files"
  on storage.objects for select
  using (
    bucket_id = 'compliance-documents'
    and exists (
      select 1 from documents d
      join compliance_records cr on cr.document_id = d.id
      where d.storage_path = storage.objects.name
        and is_org_admin(cr.organization_id)
    )
  );