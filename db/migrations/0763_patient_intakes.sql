-- The case-paper fields clinics collect at registration (blood group, second phone, emergency contact,
-- referral, best time to call, occupation, how they heard of us, family doctor, free-text health note,
-- pregnancy and nursing). One row per patient, replaced as a whole by the desk or filled when a QR
-- arrival is accepted. Personal values are masked in the change history; erasure deletes the row.
-- Expand only: a new table.
set local lock_timeout = '5s';

create table aarogyam.patient_intakes (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  alt_phone text check (alt_phone ~ '^\+[1-9][0-9]{7,14}$'),
  emergency_contact_name text check (char_length(emergency_contact_name) between 1 and 120),
  emergency_contact_phone text check (emergency_contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  referred_by text check (char_length(referred_by) between 1 and 120),
  call_time text check (call_time in ('morning', 'afternoon', 'evening', 'any')),
  occupation text check (char_length(occupation) between 1 and 80),
  heard_via text check (heard_via in ('friend_family', 'doctor', 'google', 'social_media', 'walk_by', 'other')),
  heard_via_text text check (char_length(heard_via_text) between 1 and 120),
  family_doctor_name text check (char_length(family_doctor_name) between 1 and 120),
  family_doctor_phone text check (family_doctor_phone ~ '^\+[1-9][0-9]{7,14}$'),
  family_doctor_address text check (char_length(family_doctor_address) between 1 and 300),
  health_other text check (char_length(health_other) between 1 and 300),
  pregnant boolean,
  due_date date,
  nursing boolean,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id)
);
create unique index patient_intakes_one on aarogyam.patient_intakes (org_id, patient_id);
comment on table aarogyam.patient_intakes is 'sensitivity=health offline=read_write lifecycle=mutable';
select app.protect_clinic_table('aarogyam.patient_intakes', 'mutable');

insert into audit.audit_config (table_name, mask) values
  ('aarogyam.patient_intakes', '{alt_phone,emergency_contact_name,emergency_contact_phone,referred_by,occupation,heard_via_text,family_doctor_name,family_doctor_phone,family_doctor_address,health_other}');

insert into audit.erasure_steps (table_name, step_order, action, set_clause, note) values
  ('aarogyam.patient_intakes', 99, 'delete', null, 'Case-paper registration fields');
