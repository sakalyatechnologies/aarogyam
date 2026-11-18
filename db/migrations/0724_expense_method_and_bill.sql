-- How an expense was paid, and an optional bill photo (docs/decisions.md, "Expenses: method and
-- bill"). The method set is the one patient and lab payments use (0042, 0715: cash, upi, card,
-- bank). Expand only: nullable, so expenses recorded before it, and ones recorded without a
-- method, stay as they are.
--
-- The bill is its own table, like a lab payment's proof (0716): expenses freeze once recorded,
-- so it is not a column. One current file per expense (JPEG, PNG or PDF, up to 10 MB like patient
-- files, the type read from its content), its bytes in the clinic's file storage under
-- `<org_id>/<id>`, reached only through a five-minute link bound to the member. A replaced or
-- removed bill stays as a superseded row (and its bytes), because it was evidence of money spent.
set local lock_timeout = '5s';

alter table aarogyam.expenses
  add column method text check (method in ('cash', 'upi', 'card', 'bank'));
comment on column aarogyam.expenses.method is 'How it was paid: cash, upi, card or bank; null when not recorded.';

create table aarogyam.expense_files (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  -- Also the name of the bytes in storage: <org_id>/<id>.
  id uuid not null default app.uuid_v7(),
  expense_id uuid not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  -- The name the sender's device gave it, tidied; shown, never used as a path.
  file_name text check (char_length(btrim(file_name)) between 1 and 120),
  -- Set when a newer bill replaces this one, or when the bill is removed.
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, expense_id) references aarogyam.expenses (org_id, id)
);
create unique index expense_files_current on aarogyam.expense_files (org_id, expense_id)
  where superseded_at is null;
comment on table aarogyam.expense_files is 'sensitivity=financial offline=server_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.expense_files', 'soft_delete');
-- The only change to a row is being superseded.
revoke update on aarogyam.expense_files from app_user;
grant update (superseded_at) on aarogyam.expense_files to app_user;
-- protect_clinic_table also adds the restrictive patient_account deny (0261).
insert into audit.audit_config (table_name, mask) values ('aarogyam.expense_files', '{file_name}');
