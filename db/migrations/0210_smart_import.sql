-- Smart import: a clinic uploads a CSV or Excel file in whatever layout it has; Aarogyam
-- suggests a mapping, previews every row and imports what is present. The parsed cells live
-- only in the import session: they are cleared on commit, on discard, and when the session
-- expires (24 hours), and are never written to the audit log. Imported patients missing
-- details get a to-do entry for the front desk.
set local lock_timeout = '5s';

create table aarogyam.import_sessions (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  file_name text not null check (char_length(file_name) between 1 and 200),
  file_kind text not null check (file_kind in ('csv', 'xlsx')),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes int not null check (size_bytes between 1 and 5242880),
  -- Every sheet of a workbook, so the clinic can pick another; empty for CSV.
  sheet_names text[] not null default '{}' check (cardinality(sheet_names) <= 50),
  sheet_name text check (char_length(sheet_name) between 1 and 100),
  -- Row of the file (1-based) holding the column headers.
  header_row int not null check (header_row >= 1),
  headers text[] not null check (cardinality(headers) between 1 and 100),
  -- The data rows as read: [[row, [cell, ...]], ...]. Null once the session ends.
  cells jsonb check (jsonb_typeof(cells) = 'array'),
  row_count int not null check (row_count between 1 and 5000),
  status text not null default 'open' check (status in ('open', 'committed', 'discarded', 'expired')),
  import_id uuid,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  check ((status = 'open') = (cells is not null)),
  check ((status = 'committed') = (import_id is not null))
);
create index import_sessions_open on aarogyam.import_sessions (org_id, expires_at) where status = 'open';
comment on table aarogyam.import_sessions is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.import_sessions', 'mutable');
-- The cells are patient data held only for the session: keep them out of the audit log.
insert into audit.audit_config (table_name, exclude) values ('aarogyam.import_sessions', '{cells}');

-- Which of our fields a column header meant last time, so the next file maps itself.
create table aarogyam.import_column_memory (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  -- The header normalised: lower case, punctuation as single spaces.
  header_key text not null check (char_length(header_key) between 1 and 120),
  field text not null check (field in ('full_name', 'sex', 'date_of_birth', 'age_years', 'phone',
    'email', 'preferred_language', 'file_number', 'legacy_id', 'address', 'last_visit', 'balance')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id)
);
create unique index import_column_memory_header on aarogyam.import_column_memory (org_id, header_key);
comment on table aarogyam.import_column_memory is 'sensitivity=internal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.import_column_memory', 'mutable');

-- Imports now come from a session (CSV or Excel) and record its file and sheet. Rows can be
-- skipped as duplicates or merged into an existing patient.
alter table aarogyam.imports drop constraint imports_source_check;
alter table aarogyam.imports add constraint imports_source_check check (source in ('csv', 'xlsx'));
alter table aarogyam.imports
  add column session_id uuid,
  add column file_name text check (char_length(file_name) between 1 and 200),
  add column sheet_name text check (char_length(sheet_name) between 1 and 100),
  add column skipped_rows int not null default 0 check (skipped_rows >= 0),
  add column merged_rows int not null default 0 check (merged_rows >= 0),
  add column incomplete_rows int not null default 0 check (incomplete_rows >= 0);
alter table aarogyam.imports drop constraint imports_check;
alter table aarogyam.imports add constraint imports_rows_add_up
  check (imported_rows + failed_rows + skipped_rows + merged_rows = total_rows);
alter table aarogyam.imports add constraint imports_session
  foreign key (org_id, session_id) references aarogyam.import_sessions (org_id, id);
-- One import per session: committing again finds this one instead of importing twice.
create unique index imports_session_once on aarogyam.imports (org_id, session_id) where session_id is not null;

alter table aarogyam.import_sessions add constraint import_sessions_import
  foreign key (org_id, import_id) references aarogyam.imports (org_id, id);
create index import_sessions_import on aarogyam.import_sessions (org_id, import_id) where import_id is not null;

alter table aarogyam.import_rows drop constraint import_rows_status_check;
alter table aarogyam.import_rows add constraint import_rows_status_check
  check (status in ('imported', 'failed', 'skipped', 'merged'));
alter table aarogyam.import_rows drop constraint import_rows_check;
alter table aarogyam.import_rows add constraint import_rows_patient
  check ((status in ('imported', 'merged')) = (patient_id is not null));
alter table aarogyam.import_rows drop constraint import_rows_check1;
alter table aarogyam.import_rows add constraint import_rows_reason
  check ((status in ('failed', 'skipped')) = (error is not null));

-- A patient imported without some details: the front desk's to-do list. What is still missing
-- is worked out from the patient's current record, so filling a detail clears it.
create table aarogyam.patient_gaps (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  import_id uuid not null,
  -- The row of the file the patient came from.
  row_number int not null check (row_number >= 2),
  missing text[] not null check (cardinality(missing) between 1 and 3
    and missing <@ array['phone', 'sex', 'date_of_birth']),
  -- Set when someone confirms the details can't be had.
  dismissed_at timestamptz,
  dismissed_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, import_id) references aarogyam.imports (org_id, id),
  check ((dismissed_at is null) = (dismissed_by is null))
);
create index patient_gaps_open on aarogyam.patient_gaps (org_id, created_at) where dismissed_at is null;
create index patient_gaps_patient on aarogyam.patient_gaps (org_id, patient_id);
create index patient_gaps_import on aarogyam.patient_gaps (org_id, import_id);
comment on table aarogyam.patient_gaps is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.patient_gaps', 'mutable');
