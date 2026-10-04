-- Specialty pack data as versioned JSON, longitudinal across visits: the dental chart first.
-- Each change is a new row that supersedes the current one for the same key (a tooth and
-- surface), so the full history (tooth 36: caries, filled, crown) is kept.
set local lock_timeout = '5s';

create table aarogyam.specialty_records (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  encounter_id uuid,
  module text not null check (module ~ '^[a-z_]{2,40}$'),
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  schema_version int not null check (schema_version >= 1),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16384),
  -- Keys used in filters, typed. Dental: FDI tooth number and surface (M, O, D, B, L).
  tooth smallint generated always as ((data ->> 'tooth')::smallint) stored,
  surface text generated always as (data ->> 'surface') stored,
  status text not null default 'current' check (status in ('current', 'superseded', 'entered_in_error')),
  supersedes_id uuid,
  error_reason text check (char_length(error_reason) between 3 and 500),
  effective_at timestamptz not null default now(),
  source text not null default 'clinician'
    check (source in ('clinician', 'assistant', 'patient', 'import', 'device', 'ai_draft', 'abdm')),
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, id, patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id),
  foreign key (org_id, supersedes_id, patient_id) references aarogyam.specialty_records (org_id, id, patient_id),
  foreign key (org_id, verified_by) references aarogyam.memberships (org_id, id),
  check (supersedes_id is distinct from id),
  check ((verified_by is null) = (verified_at is null)),
  check (source <> 'ai_draft' or verified_by is not null),
  check ((status = 'entered_in_error') = (error_reason is not null)),
  -- Dental entries name a valid FDI tooth (11-48 permanent, 51-85 primary) and surface.
  check (module <> 'dental' or (
    tooth is not null
    and ((tooth / 10 between 1 and 4 and tooth % 10 between 1 and 8)
      or (tooth / 10 between 5 and 8 and tooth % 10 between 1 and 5))
    and (surface is null or surface in ('M', 'O', 'D', 'B', 'L'))))
);
create index specialty_records_patient on aarogyam.specialty_records (org_id, patient_id, module, kind, effective_at desc);
create index specialty_records_tooth on aarogyam.specialty_records (org_id, patient_id, tooth, effective_at desc)
  where module = 'dental';
-- One current entry per tooth and surface ('' is the whole tooth).
create unique index specialty_records_one_current_tooth on aarogyam.specialty_records
  (org_id, patient_id, kind, tooth, coalesce(surface, ''))
  where module = 'dental' and status = 'current';
create index specialty_records_encounter on aarogyam.specialty_records (org_id, encounter_id, patient_id)
  where encounter_id is not null;
create unique index specialty_records_supersedes on aarogyam.specialty_records (org_id, supersedes_id, patient_id)
  where supersedes_id is not null;
create index specialty_records_verified_by on aarogyam.specialty_records (org_id, verified_by)
  where verified_by is not null;
comment on table aarogyam.specialty_records is 'sensitivity=health offline=read_write lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.specialty_records', 'finalizable');
create trigger freeze_when_final before update on aarogyam.specialty_records
  for each row execute function app.freeze_when(
    'status', 'current,superseded,entered_in_error', 'current>superseded,current>entered_in_error', 'error_reason');
