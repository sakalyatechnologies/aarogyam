-- Other numbers a patient is known by: the clinic's own file number, the ID from the old
-- software, a smart card or ABHA. Unique per clinic and kind, so a search by one finds one patient.
set local lock_timeout = '5s';

create table aarogyam.patient_identifiers (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  kind text not null check (kind in ('file_number', 'legacy', 'smart_card', 'abha_number', 'abha_address')),
  value text not null check (char_length(value) between 1 and 64 and value = btrim(value)),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id)
);
create unique index patient_identifiers_value on aarogyam.patient_identifiers (org_id, kind, value)
  where deleted_at is null;
create index patient_identifiers_patient on aarogyam.patient_identifiers (org_id, patient_id);
comment on table aarogyam.patient_identifiers is 'sensitivity=personal offline=read_write lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.patient_identifiers', 'soft_delete');
