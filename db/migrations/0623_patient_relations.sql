-- Family profiles: a patient can be linked to a relative in the same clinic, so the front desk
-- finds a family by the phone they share and a new walk-in can be attached to it. A row says
-- what `related_patient_id` is to `patient_id`: `guardian` (a parent or other guardian), `child`,
-- `spouse` or `other`. One row per pair; the pair is not mirrored (the reader looks both ways).
-- Both patients are in the clinic of the row (composite keys include org_id).
set local lock_timeout = '5s';

create table aarogyam.patient_relations (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  related_patient_id uuid not null,
  relation text not null check (relation in ('guardian', 'child', 'spouse', 'other')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, related_patient_id) references aarogyam.patients (org_id, id),
  check (patient_id <> related_patient_id)
);
-- One link per pair, whichever way round it was written.
create unique index patient_relations_pair on aarogyam.patient_relations
  (org_id, least(patient_id, related_patient_id), greatest(patient_id, related_patient_id));
create index patient_relations_patient on aarogyam.patient_relations (org_id, patient_id);
create index patient_relations_related on aarogyam.patient_relations (org_id, related_patient_id);
comment on table aarogyam.patient_relations is 'sensitivity=personal offline=server_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.patient_relations', 'ephemeral');

-- Erasure (0345): erasing either patient removes the link (as for possible duplicates, 0347).
-- Retention: it is part of the patient record's class (decisions.md).
insert into audit.erasure_steps (table_name, step_order, action, set_clause, filter, note) values
  ('aarogyam.patient_relations', 36, 'delete', null, 'patient_id = $2 or related_patient_id = $2',
   'family links');
