-- Erasing a patient removes their files' bytes too (docs/decisions.md, "Erasure job"). The erase
-- job records, in the same transaction as app.erase_patient, every stored file of the patient
-- (attachments, the photo, files in chat messages about them), then deletes the bytes from
-- storage and marks each done. A run that fails part way leaves the rest queued, and the next
-- run retries them. Only ids are kept: no names, captions or file contents.
set local lock_timeout = '5s';

create table audit.erased_files (
  org_id uuid not null,
  -- The file's id; its storage key is <org_id>/<file_id>.
  file_id uuid not null,
  patient_id uuid not null,
  run_id uuid not null,
  queued_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (org_id, file_id)
);
create index erased_files_pending on audit.erased_files (queued_at) where deleted_at is null;
comment on table audit.erased_files is 'sensitivity=internal offline=server_only lifecycle=mutable';
alter table audit.erased_files enable row level security;

-- Attachments were kept; now they are soft-deleted with their words cleared. The rows stay
-- because payments and signed consents refer to them.
update audit.erasure_steps
  set action = 'update',
      set_clause = 'caption = null, label = null, shared_with_patient = false, deleted_at = coalesce(deleted_at, now())',
      note = 'files: soft-deleted with caption and label cleared; the bytes are deleted by the erase job (audit.erased_files)'
  where table_name = 'aarogyam.attachments';
