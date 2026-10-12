-- Family under one mobile number: who is related to whom, inside one clinic. A row reads "the
-- related patient is this patient's <relation>" (guardian, child, spouse, parent, sibling,
-- other). The app writes the inverse row in the same transaction (guardian <-> child,
-- parent <-> child, spouse, sibling and other map to themselves) and deletes both together, so
-- either side lists the other. Rows are ephemeral: a wrong link is deleted, not retired. The
-- change history keeps who linked and unlinked whom. Erasing a patient removes their rows.
set local lock_timeout = '5s';

create table aarogyam.patient_relations (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  related_patient_id uuid not null,
  relation text not null
    check (relation in ('guardian', 'child', 'spouse', 'parent', 'sibling', 'other')),
  is_primary_contact boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, patient_id, related_patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, related_patient_id) references aarogyam.patients (org_id, id),
  check (patient_id <> related_patient_id)
);
-- "Who is related to this patient" is the unique key; the reverse lookup (erasure, merges) needs this.
create index patient_relations_related on aarogyam.patient_relations (org_id, related_patient_id);
comment on table aarogyam.patient_relations is 'sensitivity=health offline=server_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.patient_relations', 'ephemeral');

insert into audit.erasure_steps (table_name, step_order, action, set_clause, filter, note) values
  ('aarogyam.patient_relations', 36, 'delete', null,
   'patient_id = $2 or related_patient_id = $2', 'family links, both directions');
