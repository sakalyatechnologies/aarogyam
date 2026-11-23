-- X-ray tooth pins, placed once and kept for the next visit (docs/plans/present-studio-design.md,
-- slice 2g). One row per attachment and tooth; moving a pin updates the row and taking one off deletes it (ephemeral grants delete). A pin is a placement
-- aid, not a clinical record. Deleted on erasure. Expand only: a new table. The unique index
-- attachments (org_id, id, patient_id) the foreign key needs already exists (0690).
set local lock_timeout = '5s';

create table aarogyam.image_pins (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  attachment_id uuid not null,
  patient_id uuid not null,
  tooth smallint not null check (
    (tooth / 10 between 1 and 4 and tooth % 10 between 1 and 8)
    or (tooth / 10 between 5 and 8 and tooth % 10 between 1 and 5)),
  x real not null check (x between 0 and 1),
  y real not null check (y between 0 and 1),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, attachment_id, patient_id) references aarogyam.attachments (org_id, id, patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id)
);
create unique index image_pins_one on aarogyam.image_pins (org_id, attachment_id, tooth);
create index image_pins_attachment on aarogyam.image_pins (org_id, attachment_id, patient_id);
create index image_pins_patient on aarogyam.image_pins (org_id, patient_id);
comment on table aarogyam.image_pins is 'sensitivity=health offline=read_write lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.image_pins', 'ephemeral');

insert into audit.erasure_steps (table_name, step_order, action, set_clause, note) values
  ('aarogyam.image_pins', 99, 'delete', null, 'X-ray tooth pins');
