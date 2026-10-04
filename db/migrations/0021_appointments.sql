-- Appointments and their history.
--
-- A chair holds one active booking at a time: an exclusion constraint refuses two active
-- (not cancelled, not no-show, not deleted) appointments whose times overlap in the same room.
-- A doctor may be booked in two chairs at once (one dentist, two chairs); the API warns instead.
set local lock_timeout = '5s';

create table aarogyam.appointments (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  practitioner_id uuid not null,
  branch_id uuid not null,
  room_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'booked'
    check (status in ('booked', 'confirmed', 'arrived', 'in_chair', 'completed', 'cancelled', 'no_show')),
  kind text not null default 'follow_up' check (kind in ('new', 'follow_up', 'procedure', 'emergency')),
  reason text check (char_length(btrim(reason)) between 1 and 200),
  notes text check (char_length(btrim(notes)) between 1 and 2000),
  source text not null default 'front_desk' check (source in ('front_desk', 'phone', 'website', 'app', 'whatsapp')),
  cancel_reason text check (char_length(btrim(cancel_reason)) between 1 and 200),
  arrived_at timestamptz,
  seated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, practitioner_id) references aarogyam.practitioners (org_id, id),
  foreign key (org_id, branch_id) references aarogyam.branches (org_id, id),
  foreign key (org_id, room_id) references aarogyam.rooms (org_id, id),
  check (starts_at < ends_at),
  check (ends_at - starts_at <= interval '12 hours'),
  check (status <> 'cancelled' or cancel_reason is not null),
  constraint appointments_room_overlap exclude using gist (
    org_id with =,
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (room_id is not null and status not in ('cancelled', 'no_show') and deleted_at is null)
);
create index appointments_branch_starts on aarogyam.appointments (org_id, branch_id, starts_at)
  where deleted_at is null;
create index appointments_practitioner_starts on aarogyam.appointments (org_id, practitioner_id, starts_at)
  where deleted_at is null;
create index appointments_patient on aarogyam.appointments (org_id, patient_id, starts_at desc);
create index appointments_room on aarogyam.appointments (org_id, room_id, starts_at) where room_id is not null;
-- Foreign-key checks when a branch, doctor or patient row is touched, whatever deleted_at says.
create index appointments_branch_fk on aarogyam.appointments (org_id, branch_id);
create index appointments_practitioner_fk on aarogyam.appointments (org_id, practitioner_id);
comment on table aarogyam.appointments is 'sensitivity=personal offline=read_write lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.appointments', 'soft_delete');

-- Every change to an appointment: booked, moved, reassigned, edited, or a status change.
create table aarogyam.appointment_events (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  appointment_id uuid not null,
  kind text not null check (kind in ('booked', 'changed', 'status')),
  from_status text check (from_status in ('booked', 'confirmed', 'arrived', 'in_chair', 'completed', 'cancelled', 'no_show')),
  to_status text check (to_status in ('booked', 'confirmed', 'arrived', 'in_chair', 'completed', 'cancelled', 'no_show')),
  -- What changed, as {"column": [old, new]} for times, room and doctor; ids and times only.
  changes jsonb check (jsonb_typeof(changes) = 'object'),
  note text check (char_length(note) <= 200),
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, appointment_id) references aarogyam.appointments (org_id, id),
  check ((kind = 'status') = (to_status is not null))
);
create index appointment_events_appointment on aarogyam.appointment_events (org_id, appointment_id, at);
comment on table aarogyam.appointment_events is 'sensitivity=personal offline=read_write lifecycle=append_only';
-- The event row is the history; the change history only needs to know it was written.
select app.protect_clinic_table('aarogyam.appointment_events', 'append_only');
insert into audit.audit_config (table_name, metadata_only) values ('aarogyam.appointment_events', true);
