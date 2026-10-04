-- Patient files: photos, X-rays, reports, documents. The bytes live in object storage (local
-- disk in development) under a key the server makes from ids; they are served only through
-- short-lived signed links after a permission check, and each download is in the access record.
set local lock_timeout = '5s';

create table aarogyam.attachments (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  encounter_id uuid,
  kind text not null default 'document'
    check (kind in ('photo', 'xray', 'report', 'document', 'audio', 'consent')),
  -- Built by the server from ids, never from a file name: <org_id>/<id>.
  storage_key text not null check (storage_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'application/pdf', 'application/dicom')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  caption text check (char_length(caption) between 1 and 300),
  tooth smallint check ((tooth / 10 between 1 and 4 and tooth % 10 between 1 and 8)
                        or (tooth / 10 between 5 and 8 and tooth % 10 between 1 and 5)),
  taken_at timestamptz,
  source text not null default 'clinician'
    check (source in ('clinician', 'assistant', 'patient', 'import', 'device', 'ai_draft', 'abdm')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id)
);
create unique index attachments_storage_key on aarogyam.attachments (org_id, storage_key);
create index attachments_patient on aarogyam.attachments (org_id, patient_id, created_at desc) where deleted_at is null;
create index attachments_encounter on aarogyam.attachments (org_id, encounter_id, patient_id) where encounter_id is not null;
comment on table aarogyam.attachments is 'sensitivity=health offline=read_write lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.attachments', 'soft_delete');
