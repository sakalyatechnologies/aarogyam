-- Money paid to labs (docs/decisions.md, "Labs"). Recording a payment records an expense in
-- the clinic's `lab` category in the same transaction, and voiding it voids that expense, so
-- the Analytics report counts lab spending once. Needs expenses.write and finance.view.
--
-- attachments.lab_order_id ties a file (a photo of the work, a lab's delivery note, a scan up to
-- 10 MB) to a lab order of the same patient. Expand only: nullable, nothing reads it yet.
set local lock_timeout = '5s';

create table aarogyam.lab_payments (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  vendor_id uuid not null,
  lab_order_id uuid,
  -- The clinic day the money went out.
  paid_on date not null,
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 1000000000),
  -- The lab's own bill number.
  lab_invoice_ref text check (char_length(btrim(lab_invoice_ref)) between 1 and 60),
  note text check (char_length(btrim(note)) between 1 and 300),
  expense_id uuid not null,
  recorded_by uuid not null,
  status text not null default 'recorded' check (status in ('recorded', 'void')),
  void_reason text check (char_length(btrim(void_reason)) between 3 and 500),
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, expense_id),
  foreign key (org_id, vendor_id) references aarogyam.lab_vendors (org_id, id),
  -- An order paid for is the same lab's.
  foreign key (org_id, lab_order_id, vendor_id) references aarogyam.lab_orders (org_id, id, vendor_id),
  foreign key (org_id, expense_id) references aarogyam.expenses (org_id, id),
  foreign key (org_id, recorded_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, voided_by) references aarogyam.memberships (org_id, id),
  check ((status = 'void') = (void_reason is not null and voided_at is not null))
);
create index lab_payments_vendor on aarogyam.lab_payments (org_id, vendor_id, paid_on desc);
create index lab_payments_order on aarogyam.lab_payments (org_id, lab_order_id, vendor_id)
  where lab_order_id is not null;
create index lab_payments_recorded_by on aarogyam.lab_payments (org_id, recorded_by);
create index lab_payments_voided_by on aarogyam.lab_payments (org_id, voided_by) where voided_by is not null;
comment on table aarogyam.lab_payments is 'sensitivity=financial offline=server_only lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.lab_payments', 'finalizable');
-- A recorded payment only changes by being voided.
create trigger freeze_when_final before update on aarogyam.lab_payments
  for each row execute function app.freeze_when_final('', 'void', 'void_reason', 'voided_at', 'voided_by');
insert into audit.audit_config (table_name, mask) values ('aarogyam.lab_payments', '{note}');

alter table aarogyam.attachments add column lab_order_id uuid;
alter table aarogyam.attachments add constraint attachments_lab_order
  foreign key (org_id, lab_order_id, patient_id) references aarogyam.lab_orders (org_id, id, patient_id)
  not valid;
alter table aarogyam.attachments validate constraint attachments_lab_order;
create index attachments_lab_order on aarogyam.attachments (org_id, lab_order_id, patient_id)
  where lab_order_id is not null;
