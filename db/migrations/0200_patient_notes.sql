-- A patient-level summary note: one per patient, edited by whoever holds clinical.write while
-- the patient is in reach, versioned with row_version (If-Match) and audited. Visit notes stay
-- in clinical_notes, where signed notes only change through addenda. The text is a strict
-- Markdown subset (headings, lists, bold, italic); the API validates it on save.
set local lock_timeout = '5s';

create table aarogyam.patient_notes (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  body text not null check (char_length(body) <= 20000),
  row_version bigint not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  -- One summary note per patient.
  unique (org_id, patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id)
);
comment on table aarogyam.patient_notes is 'sensitivity=health offline=read_write lifecycle=mutable';
select app.protect_clinic_table('aarogyam.patient_notes', 'mutable');
create trigger row_version before update on aarogyam.patient_notes
  for each row execute function app.bump_row_version();

insert into audit.audit_config (table_name, exclude) values
  ('aarogyam.patient_notes', '{row_version}')
on conflict (table_name) do update
  set exclude = array(select distinct unnest(audit.audit_config.exclude || '{row_version}'::text[]));
