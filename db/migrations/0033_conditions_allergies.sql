-- Patient-level clinical facts: the problem list and allergies. They live on the patient and
-- may be updated during a visit, which is recorded when there is one.
set local lock_timeout = '5s';

create table aarogyam.conditions (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  encounter_id uuid,
  display_text text not null check (char_length(btrim(display_text)) between 1 and 300),
  code_system text check (code_system in ('icd10', 'icd11', 'snomed', 'loinc', 'custom')),
  code text check (char_length(code) between 1 and 40),
  status text not null default 'active' check (status in ('active', 'resolved', 'entered_in_error')),
  -- Shown in the patient's clinical flags banner while active (diabetes, a bleeding disorder,
  -- pregnancy, a heart condition).
  flagged boolean not null default false,
  onset date check (onset >= date '1900-01-01'),
  note text check (char_length(note) <= 1000),
  source text not null default 'clinician'
    check (source in ('clinician', 'assistant', 'patient', 'import', 'device', 'ai_draft', 'abdm')),
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id),
  foreign key (org_id, verified_by) references aarogyam.memberships (org_id, id),
  check ((verified_by is null) = (verified_at is null)),
  check (source <> 'ai_draft' or verified_by is not null),
  check ((code is null) = (code_system is null))
);
create index conditions_patient on aarogyam.conditions (org_id, patient_id, status);
create index conditions_encounter on aarogyam.conditions (org_id, encounter_id, patient_id) where encounter_id is not null;
create index conditions_verified_by on aarogyam.conditions (org_id, verified_by) where verified_by is not null;
comment on table aarogyam.conditions is 'sensitivity=health offline=read_write lifecycle=mutable';
select app.protect_clinic_table('aarogyam.conditions', 'mutable');

create table aarogyam.allergies (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  substance text not null check (char_length(btrim(substance)) between 1 and 200),
  code_system text check (code_system in ('icd10', 'icd11', 'snomed', 'loinc', 'custom')),
  code text check (char_length(code) between 1 and 40),
  reaction text check (char_length(reaction) between 1 and 500),
  severity text not null default 'moderate' check (severity in ('mild', 'moderate', 'severe')),
  status text not null default 'active' check (status in ('active', 'resolved', 'entered_in_error')),
  source text not null default 'clinician'
    check (source in ('clinician', 'assistant', 'patient', 'import', 'device', 'ai_draft', 'abdm')),
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, verified_by) references aarogyam.memberships (org_id, id),
  check ((verified_by is null) = (verified_at is null)),
  check (source <> 'ai_draft' or verified_by is not null),
  check ((code is null) = (code_system is null))
);
create index allergies_patient on aarogyam.allergies (org_id, patient_id, status);
create index allergies_verified_by on aarogyam.allergies (org_id, verified_by) where verified_by is not null;
comment on table aarogyam.allergies is 'sensitivity=health offline=read_write lifecycle=mutable';
select app.protect_clinic_table('aarogyam.allergies', 'mutable');
