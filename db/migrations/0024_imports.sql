-- Imports of patients from a spreadsheet or old software, with each row's result.
set local lock_timeout = '5s';

create table aarogyam.imports (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  kind text not null check (kind in ('patients')),
  source text not null default 'csv' check (source in ('csv')),
  -- Our field name to the file's column header.
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  status text not null default 'done' check (status in ('done', 'failed')),
  total_rows int not null check (total_rows between 0 and 5000),
  imported_rows int not null check (imported_rows >= 0),
  failed_rows int not null check (failed_rows >= 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  check (imported_rows + failed_rows = total_rows)
);
comment on table aarogyam.imports is 'sensitivity=internal offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.imports', 'append_only');

create table aarogyam.import_rows (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  import_id uuid not null,
  -- Line in the file, counting the header as line 1.
  row_number int not null check (row_number >= 2),
  -- The row's mapped values as read, so a failed row can be fixed and imported again.
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  status text not null check (status in ('imported', 'failed')),
  error text check (char_length(error) <= 300),
  patient_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, import_id) references aarogyam.imports (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  check ((status = 'imported') = (patient_id is not null)),
  check ((status = 'failed') = (error is not null))
);
create unique index import_rows_row on aarogyam.import_rows (org_id, import_id, row_number);
create index import_rows_patient on aarogyam.import_rows (org_id, patient_id) where patient_id is not null;
comment on table aarogyam.import_rows is 'sensitivity=personal offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.import_rows', 'append_only');
