-- The patient import keeps the clinic's original file and brings in the balance column
-- (docs/decisions.md, "The import keeps its file and brings in balances", 15 Nov 2026).
--
-- 1. `import_files`: the file as uploaded, one per import session. The bytes live in the same
--    file storage as patient files, under `<clinic>/<id>` (Supabase Storage in Mumbai, or local
--    disk in development); this row names no path. It is full of names and phones, so it is
--    personal data: the clinic can open it (a five-minute signed link) and delete it (the row and
--    the bytes) whenever it likes; retention class `import_files` (365 days, report only).
--    Deleting the file leaves the session and the patients it created untouched.
-- 2. `import_rows` records the opening-balance bill a row made, so a repeated commit finds it
--    instead of billing twice: the row (import, row number) is unique already.
set local lock_timeout = '5s';

create table aarogyam.import_files (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  -- Also the name of the bytes in storage: <org_id>/<id>.
  id uuid not null default app.uuid_v7(),
  session_id uuid not null,
  -- The name it was uploaded with, tidied; shown, never used as a path. May name a patient.
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in
    ('text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  -- One original file per session; also the index of the key.
  unique (org_id, session_id),
  foreign key (org_id, session_id) references aarogyam.import_sessions (org_id, id)
);
comment on table aarogyam.import_files is 'sensitivity=personal offline=server_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.import_files', 'ephemeral');
-- The name may carry a patient's name; keep it out of the change history. The change history
-- still shows that a file was stored and deleted, and by whom.
insert into audit.audit_config (table_name, mask) values ('aarogyam.import_files', '{file_name}');
-- Sakalya support sees that a clinic imported, never the file.
create policy no_support on aarogyam.import_files as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');

alter table aarogyam.import_rows
  add column opening_invoice_id uuid,
  add column opening_paise bigint check (opening_paise > 0),
  add constraint import_rows_opening check ((opening_invoice_id is null) = (opening_paise is null)),
  add constraint import_rows_opening_invoice
    foreign key (org_id, opening_invoice_id) references aarogyam.invoices (org_id, id);
-- One bill per row, ever; also the index of the foreign key.
create unique index import_rows_opening_once on aarogyam.import_rows (org_id, opening_invoice_id)
  where opening_invoice_id is not null;
