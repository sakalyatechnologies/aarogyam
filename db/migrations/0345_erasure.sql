-- Erasing patient records past retention (docs/decisions.md, "Erasure job"). The operator job
-- `aarogyam erase --apply --clinic <slug>` calls app.erase_patient once per patient, each in its
-- own transaction, over the schema owner's connection; the API can't call it.
--
-- What happens to a patient's rows is data, not code: audit.erasure_steps lists, per table,
-- which rows belong to the patient and whether they are deleted, updated (scrubbed) or kept. A
-- new table that holds patient data (labs, messages, chat) registers itself with one insert in
-- its own migration. Whatever the action, the change history of every listed row is scrubbed.
set local lock_timeout = '5s';

create table audit.erasure_steps (
  table_name text primary key check (table_name ~ '^[a-z_]+\.[a-z_]+$'),
  step_order int not null,
  -- delete the rows, update them with set_clause, or keep them (only their history is scrubbed)
  action text not null check (action in ('delete', 'update', 'keep')),
  set_clause text,
  -- Which rows are the patient's: SQL over the table's columns, $2 being the patient's id.
  filter text not null default 'patient_id = $2',
  note text not null,
  check ((action = 'update') = (set_clause is not null))
);
comment on table audit.erasure_steps is 'sensitivity=internal offline=server_only lifecycle=mutable';
alter table audit.erasure_steps enable row level security;

insert into audit.erasure_steps (table_name, step_order, action, set_clause, note) values
  ('aarogyam.patient_identifiers', 10, 'delete', null, 'Aadhaar, ABHA and other numbers'),
  ('aarogyam.patient_link_codes', 20, 'delete', null, 'app link codes'),
  ('aarogyam.share_links', 30, 'delete', null, 'links to documents'),
  ('aarogyam.patient_gaps', 40, 'delete', null, 'missing-details to-do entries'),
  ('aarogyam.patient_notes', 50, 'delete', null, 'front desk summary notes'),
  ('aarogyam.recalls', 60, 'delete', null, 'recall reasons'),
  ('aarogyam.patient_links', 70, 'update',
   'status = case status when ''active'' then ''revoked'' when ''pending'' then ''declined'' else status end, '
   'revoked_at = case when status = ''active'' then now() else revoked_at end, '
   'revoked_by = case when status = ''active'' then ''clinic'' else revoked_by end', 'app links end'),
  ('aarogyam.import_rows', 80, 'update', 'raw = ''{}''::jsonb', 'imported spreadsheet cells'),
  ('aarogyam.invoices', 90, 'update',
   'recipient = case when recipient is null then null else jsonb_build_object(''erased'', true) end',
   'bills keep lines and totals; the printed name goes'),
  ('aarogyam.appointments', 100, 'keep', null, 'statistics'),
  ('aarogyam.queue_tokens', 100, 'keep', null, 'statistics'),
  ('aarogyam.encounters', 100, 'keep', null, 'statistics'),
  ('aarogyam.clinical_notes', 100, 'keep', null, 'not yet erased (backlog)'),
  ('aarogyam.observations', 100, 'keep', null, 'not yet erased (backlog)'),
  ('aarogyam.conditions', 100, 'keep', null, 'not yet erased (backlog)'),
  ('aarogyam.allergies', 100, 'keep', null, 'not yet erased (backlog)'),
  ('aarogyam.specialty_records', 100, 'keep', null, 'not yet erased (backlog)'),
  ('aarogyam.treatment_plans', 100, 'keep', null, 'not yet erased (backlog)'),
  ('aarogyam.procedures', 100, 'keep', null, 'statistics'),
  ('aarogyam.attachments', 100, 'keep', null, 'files: not yet erased (backlog)'),
  ('aarogyam.prescriptions', 100, 'keep', null, 'not yet erased (backlog)'),
  ('aarogyam.treatment_plan_items', 100, 'keep', null, 'not yet erased (backlog)'),
  ('aarogyam.payments', 100, 'keep', null, 'kept with the bills'),
  ('aarogyam.payment_allocations', 100, 'keep', null, 'kept with the bills'),
  ('aarogyam.patient_consents', 100, 'keep', null, 'consent records stay with the tombstone');

-- Patients erased, so a restore from backup can be replayed (`aarogyam erase --replay`). Ids only.
create table audit.erasure_log (
  org_id uuid not null,
  patient_id uuid not null,
  run_id uuid not null,
  erased_at timestamptz not null default now(),
  primary key (org_id, patient_id)
);
comment on table audit.erasure_log is 'sensitivity=internal offline=server_only lifecycle=append_only';
alter table audit.erasure_log enable row level security;
create trigger forbid_change before update or delete on audit.erasure_log
  for each row execute function app.forbid_change();
