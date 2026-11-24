-- The tooth colour a doctor settled on in Show patient (Painted smile), kept for the patient's next
-- visit. One row per patient, replaced in place. A display preference, not a clinical record.
-- Deleted on erasure. Expand only: a new table.
set local lock_timeout = '5s';

create table aarogyam.patient_smile_shades (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  shade smallint not null check (shade between 0 and 100),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id)
);
create unique index patient_smile_shades_one on aarogyam.patient_smile_shades (org_id, patient_id);
comment on table aarogyam.patient_smile_shades is 'sensitivity=health offline=read_write lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.patient_smile_shades', 'ephemeral');

insert into audit.erasure_steps (table_name, step_order, action, set_clause, note) values
  ('aarogyam.patient_smile_shades', 99, 'delete', null, 'Saved tooth colour for Show patient');
