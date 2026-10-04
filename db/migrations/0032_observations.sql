-- Measurements (vitals). A value is never edited: a correction is a new row that supersedes
-- it, and the old row stays visible as corrected.
set local lock_timeout = '5s';

create table aarogyam.observations (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  encounter_id uuid,
  kind text not null check (kind in ('bp_systolic', 'bp_diastolic', 'pulse', 'temperature', 'spo2',
                                     'weight', 'height', 'blood_sugar')),
  value_num numeric(8, 2) not null,
  -- UCUM units: mmHg, /min, Cel, [degF], %, kg, cm, mg/dL.
  unit text not null check (unit in ('mmHg', '/min', 'Cel', '[degF]', '%', 'kg', 'cm', 'mg/dL')),
  code_system text check (code_system in ('icd10', 'icd11', 'snomed', 'loinc', 'custom')),
  code text check (char_length(code) between 1 and 40),
  recorded_at timestamptz not null default now(),
  status text not null default 'final' check (status in ('final', 'corrected', 'entered_in_error')),
  supersedes_id uuid,
  error_reason text check (char_length(error_reason) between 3 and 500),
  source text not null default 'clinician'
    check (source in ('clinician', 'assistant', 'patient', 'import', 'device', 'ai_draft', 'abdm')),
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  -- A correction must be of the same patient and the same measurement.
  unique (org_id, id, patient_id, kind),
  foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id),
  foreign key (org_id, supersedes_id, patient_id, kind) references aarogyam.observations (org_id, id, patient_id, kind),
  foreign key (org_id, verified_by) references aarogyam.memberships (org_id, id),
  check (supersedes_id is distinct from id),
  check ((verified_by is null) = (verified_at is null)),
  -- Nothing drafted by AI enters the record until a person confirms it.
  check (source <> 'ai_draft' or verified_by is not null),
  check ((status = 'entered_in_error') = (error_reason is not null)),
  check ((code is null) = (code_system is null))
);
create index observations_patient on aarogyam.observations (org_id, patient_id, kind, recorded_at desc);
create index observations_encounter on aarogyam.observations (org_id, encounter_id, patient_id)
  where encounter_id is not null;
-- Each value is corrected at most once; the correction can itself be corrected.
create unique index observations_supersedes on aarogyam.observations (org_id, supersedes_id, patient_id, kind)
  where supersedes_id is not null;
create index observations_verified_by on aarogyam.observations (org_id, verified_by) where verified_by is not null;
comment on table aarogyam.observations is 'sensitivity=health offline=read_write lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.observations', 'finalizable');
create trigger freeze_when_final before update on aarogyam.observations
  for each row execute function app.freeze_when(
    'status', 'final,corrected,entered_in_error', 'final>corrected,final>entered_in_error', 'error_reason');
