-- Treatment plans with estimates, their items, and procedures planned or done in a visit.
-- Completing a procedure for a plan item marks the item done.
set local lock_timeout = '5s';

create table aarogyam.treatment_plans (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  clinician_id uuid not null,
  encounter_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'in_progress', 'completed', 'declined')),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, id, patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, clinician_id) references aarogyam.memberships (org_id, id),
  foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id),
  check ((accepted_at is not null) = (status in ('accepted', 'in_progress', 'completed')))
);
create index treatment_plans_patient on aarogyam.treatment_plans (org_id, patient_id, created_at desc);
create index treatment_plans_clinician on aarogyam.treatment_plans (org_id, clinician_id);
create index treatment_plans_encounter on aarogyam.treatment_plans (org_id, encounter_id, patient_id)
  where encounter_id is not null;
comment on table aarogyam.treatment_plans is 'sensitivity=health offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.treatment_plans', 'mutable');

create table aarogyam.treatment_plan_items (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  plan_id uuid not null,
  patient_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  code_system text check (code_system in ('icd10', 'icd11', 'snomed', 'loinc', 'custom')),
  code text check (char_length(code) between 1 and 40),
  tooth smallint check ((tooth / 10 between 1 and 4 and tooth % 10 between 1 and 8)
                        or (tooth / 10 between 5 and 8 and tooth % 10 between 1 and 5)),
  surfaces text[] not null default '{}' check (surfaces <@ array['M', 'O', 'D', 'B', 'L']),
  phase smallint not null default 1 check (phase between 1 and 20),
  estimate_paise bigint not null check (estimate_paise between 0 and 100000000000),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, id, patient_id),
  foreign key (org_id, plan_id, patient_id) references aarogyam.treatment_plans (org_id, id, patient_id),
  check ((code is null) = (code_system is null))
);
create index treatment_plan_items_plan on aarogyam.treatment_plan_items (org_id, plan_id, patient_id);
comment on table aarogyam.treatment_plan_items is 'sensitivity=health offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.treatment_plan_items', 'mutable');

create table aarogyam.procedures (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  encounter_id uuid not null,
  patient_id uuid not null,
  clinician_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  code_system text check (code_system in ('icd10', 'icd11', 'snomed', 'loinc', 'custom')),
  code text check (char_length(code) between 1 and 40),
  tooth smallint check ((tooth / 10 between 1 and 4 and tooth % 10 between 1 and 8)
                        or (tooth / 10 between 5 and 8 and tooth % 10 between 1 and 5)),
  surfaces text[] not null default '{}' check (surfaces <@ array['M', 'O', 'D', 'B', 'L']),
  status text not null default 'done' check (status in ('planned', 'done', 'entered_in_error')),
  performed_at timestamptz,
  price_paise bigint check (price_paise between 0 and 100000000000),
  treatment_plan_item_id uuid,
  note text check (char_length(note) <= 1000),
  error_reason text check (char_length(error_reason) between 3 and 500),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id),
  foreign key (org_id, clinician_id) references aarogyam.memberships (org_id, id),
  -- A plan item of another patient can't be completed here.
  foreign key (org_id, treatment_plan_item_id, patient_id)
    references aarogyam.treatment_plan_items (org_id, id, patient_id),
  check ((status = 'done') = (performed_at is not null) or status = 'entered_in_error'),
  check ((status = 'entered_in_error') = (error_reason is not null)),
  check ((code is null) = (code_system is null))
);
create index procedures_encounter on aarogyam.procedures (org_id, encounter_id, patient_id);
create index procedures_patient on aarogyam.procedures (org_id, patient_id, created_at desc);
create index procedures_clinician on aarogyam.procedures (org_id, clinician_id);
-- A plan item is carried out by one procedure (a mistaken one can be marked entered in error).
create unique index procedures_plan_item on aarogyam.procedures (org_id, treatment_plan_item_id, patient_id)
  where treatment_plan_item_id is not null and status <> 'entered_in_error';
comment on table aarogyam.procedures is 'sensitivity=health offline=read_write lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.procedures', 'finalizable');
create trigger freeze_when_final before update on aarogyam.procedures
  for each row execute function app.freeze_when(
    'status', 'done,entered_in_error', 'done>entered_in_error', 'error_reason');
