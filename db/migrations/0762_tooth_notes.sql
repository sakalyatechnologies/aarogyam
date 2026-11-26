-- Free-text notes on a tooth: the doctor types or dictates what they saw, with no treatment and
-- no health status. Each note is its own record, shown newest first the next time the tooth is
-- opened. Append-only: to fix a note the doctor adds a new one. client_id makes a retry after a
-- lost answer return the first note. Deleted on erasure. Expand only: a new table.
set local lock_timeout = '5s';

create table aarogyam.tooth_notes (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  tooth smallint not null check (
    (tooth / 10 between 1 and 4 and tooth % 10 between 1 and 8)
    or (tooth / 10 between 5 and 8 and tooth % 10 between 1 and 5)),
  visit_id uuid,
  body text not null check (char_length(body) between 1 and 2000),
  client_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, visit_id, patient_id) references aarogyam.encounters (org_id, id, patient_id)
);
create index tooth_notes_by_tooth on aarogyam.tooth_notes (org_id, patient_id, tooth, created_at desc);
create index tooth_notes_visit on aarogyam.tooth_notes (org_id, visit_id, patient_id) where visit_id is not null;
create unique index tooth_notes_client_id on aarogyam.tooth_notes (org_id, client_id) where client_id is not null;
comment on table aarogyam.tooth_notes is 'sensitivity=health offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.tooth_notes', 'append_only');

insert into audit.erasure_steps (table_name, step_order, action, set_clause, note) values
  ('aarogyam.tooth_notes', 99, 'delete', null, 'Free-text tooth notes');
