-- A patient's own photo (a face for the list and the record header): PNG or JPEG of at most
-- 2 MB, kept in file storage under the clinic's folder beside the patient files, found through
-- this row. One photo a patient; a replacement is a new row (a new storage key, so no cache
-- shows the old one) and the old row goes in the same transaction. Unlike a staff avatar a
-- patient's photo is patient data: it is read only through the API after a permission check,
-- never through a signed link, and erasure deletes the row.
set local lock_timeout = '5s';

create table aarogyam.patient_photos (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  -- Also the file's name in storage: <org_id>/<id>.
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 2097152),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id)
);
comment on table aarogyam.patient_photos is 'sensitivity=health offline=server_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.patient_photos', 'ephemeral');

-- Erasure (0345): the row goes with the patient. The bytes in storage are removed with the
-- patient's other files when that part of erasure is built (docs/backlog.md).
insert into audit.erasure_steps (table_name, step_order, action, set_clause, filter, note) values
  ('aarogyam.patient_photos', 55, 'delete', null, 'patient_id = $2', 'the patient''s own photo');

-- Sakalya support sees that a clinic has patients, never their faces.
create policy no_support on aarogyam.patient_photos as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');
