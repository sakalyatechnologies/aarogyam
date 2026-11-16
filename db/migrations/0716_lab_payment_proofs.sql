-- A proof of a payment to a lab (docs/decisions.md, "Labs"): optionally one file, a receipt photo,
-- a UPI screenshot or a PDF (JPEG, PNG or PDF, up to 10 MB like patient files, the type read from
-- its content). Lab payments name no patient, so the file is not a patient attachment; like a chat
-- file it is a row here plus bytes in the clinic's file storage under `<org_id>/<id>`, reached only
-- through a five-minute link bound to the member. lab_payments itself freezes once recorded, so
-- the proof is its own table: a replaced proof stays as a superseded row (and its bytes), because
-- it was evidence of money paid. At most one current proof per payment. Expand only.
set local lock_timeout = '5s';

create table aarogyam.lab_payment_files (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  -- Also the name of the bytes in storage: <org_id>/<id>.
  id uuid not null default app.uuid_v7(),
  lab_payment_id uuid not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  -- The name the sender's device gave it, tidied; shown, never used as a path.
  file_name text check (char_length(btrim(file_name)) between 1 and 120),
  -- Set when a newer proof replaces this one, or when the proof is removed.
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, lab_payment_id) references aarogyam.lab_payments (org_id, id)
);
create unique index lab_payment_files_current on aarogyam.lab_payment_files (org_id, lab_payment_id)
  where superseded_at is null;
comment on table aarogyam.lab_payment_files is 'sensitivity=financial offline=server_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.lab_payment_files', 'soft_delete');
-- The only change to a row is being superseded.
revoke update on aarogyam.lab_payment_files from app_user;
grant update (superseded_at) on aarogyam.lab_payment_files to app_user;
-- protect_clinic_table also adds the restrictive patient_account deny (0261).
insert into audit.audit_config (table_name, mask) values ('aarogyam.lab_payment_files', '{file_name}');
