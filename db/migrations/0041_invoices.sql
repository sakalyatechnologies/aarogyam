-- Bills. A draft is edited freely; issuing assigns the number, computes GST per line, and
-- snapshots what the paper shows (supplier and patient), after which the bill never changes.
-- A mistake is voided with a reason and billed again. Whether it is paid is derived from
-- payment allocations, never stored on the bill.
--
-- encounter_id and procedure_id are plain columns for now: visits and procedures arrive in a
-- parallel branch, and a follow-up migration adds their composite foreign keys after it merges.
set local lock_timeout = '5s';

create table aarogyam.invoices (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  -- SD/26-27/000318: prefix, financial year in clinic time, six-digit serial. GST allows 16
  -- characters per GSTIN.
  number text check (number ~ '^[A-Z]{1,3}/[0-9]{2}-[0-9]{2}/[0-9]{6}$' and char_length(number) <= 16),
  series text not null default 'main' check (series ~ '^[a-z0-9_-]{1,32}$'),
  financial_year text check (financial_year ~ '^[0-9]{2}-[0-9]{2}$'),
  patient_id uuid not null,
  encounter_id uuid,
  branch_id uuid not null,
  doc_type text check (doc_type in ('tax_invoice', 'bill_of_supply')),
  status text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  -- State code of the place of supply; IGST applies when it differs from the branch's state.
  place_of_supply text check (place_of_supply ~ '^[0-9]{2}$'),
  notes text check (char_length(notes) <= 1000),
  issued_at timestamptz,
  issued_by uuid,
  -- Printed facts captured at issue: the clinic's legal name, GSTIN, address and state, and
  -- the patient's name and number.
  supplier jsonb check (jsonb_typeof(supplier) = 'object'),
  recipient jsonb check (jsonb_typeof(recipient) = 'object'),
  subtotal_paise bigint not null default 0 check (subtotal_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  taxable_paise bigint not null default 0 check (taxable_paise >= 0),
  cgst_paise bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise bigint not null default 0 check (sgst_paise >= 0),
  igst_paise bigint not null default 0 check (igst_paise >= 0),
  tax_paise bigint not null default 0 check (tax_paise >= 0),
  round_off_paise bigint not null default 0 check (round_off_paise between -50 and 50),
  total_paise bigint not null default 0 check (total_paise >= 0),
  replaces_invoice_id uuid,
  void_reason text check (char_length(btrim(void_reason)) between 3 and 500),
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  -- Payment allocations name the patient too, so a payment can't settle another patient's bill.
  unique (org_id, id, patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, branch_id) references aarogyam.branches (org_id, id),
  foreign key (org_id, replaces_invoice_id) references aarogyam.invoices (org_id, id),
  foreign key (org_id, issued_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, voided_by) references aarogyam.memberships (org_id, id),
  check ((number is null) = (issued_at is null)),
  check (status <> 'issued' or (number is not null and doc_type is not null and financial_year is not null
                                and supplier is not null and recipient is not null)),
  check ((status = 'void') = (void_reason is not null and voided_at is not null)),
  check (total_paise = taxable_paise + tax_paise + round_off_paise),
  check (tax_paise = cgst_paise + sgst_paise + igst_paise)
);
create unique index invoices_number on aarogyam.invoices (org_id, number) where number is not null;
create unique index invoices_replaces on aarogyam.invoices (org_id, replaces_invoice_id)
  where replaces_invoice_id is not null;
create index invoices_issued on aarogyam.invoices (org_id, issued_at) where status <> 'draft';
create index invoices_patient on aarogyam.invoices (org_id, patient_id, created_at desc);
create index invoices_branch on aarogyam.invoices (org_id, branch_id);
create index invoices_issued_by on aarogyam.invoices (org_id, issued_by) where issued_by is not null;
create index invoices_voided_by on aarogyam.invoices (org_id, voided_by) where voided_by is not null;
create index invoices_encounter on aarogyam.invoices (org_id, encounter_id) where encounter_id is not null;
comment on table aarogyam.invoices is 'sensitivity=personal offline=server_only lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.invoices', 'finalizable');
create trigger freeze_when_final before update on aarogyam.invoices
  for each row execute function app.freeze_when_final('draft', 'void', 'void_reason', 'voided_at', 'voided_by');

create table aarogyam.invoice_items (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  invoice_id uuid not null,
  line_no smallint not null check (line_no between 1 and 200),
  price_item_id uuid,
  procedure_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 300),
  sac_hsn text check (sac_hsn ~ '^[0-9]{4,8}$'),
  category text check (category ~ '^[a-z][a-z0-9_]{0,39}$'),
  quantity int not null check (quantity between 1 and 10000),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  tax_rate_bps int not null default 0 check (tax_rate_bps in (0, 500, 1200, 1800)),
  -- Computed at issue; zero on drafts.
  taxable_paise bigint not null default 0 check (taxable_paise >= 0),
  cgst_paise bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise bigint not null default 0 check (sgst_paise >= 0),
  igst_paise bigint not null default 0 check (igst_paise >= 0),
  total_paise bigint not null default 0 check (total_paise >= 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, invoice_id, line_no),
  foreign key (org_id, invoice_id) references aarogyam.invoices (org_id, id),
  foreign key (org_id, price_item_id) references aarogyam.price_items (org_id, id)
);
create index invoice_items_price_item on aarogyam.invoice_items (org_id, price_item_id)
  where price_item_id is not null;
create index invoice_items_procedure on aarogyam.invoice_items (org_id, procedure_id)
  where procedure_id is not null;
comment on table aarogyam.invoice_items is 'sensitivity=personal offline=server_only lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.invoice_items', 'finalizable');
create trigger freeze_with_parent before insert or update or delete on aarogyam.invoice_items
  for each row execute function app.freeze_with_parent('aarogyam.invoices', 'invoice_id');

-- Removes a draft's lines so an edit can write them again. Lines of an issued or void bill
-- are never removed: the parent check here and the line trigger both refuse.
create function app.clear_draft_invoice_lines(p_invoice_id uuid)
  returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
  begin
    delete from aarogyam.invoice_items i
    using aarogyam.invoices v
    where i.org_id = app.tenant_id() and i.invoice_id = p_invoice_id
      and v.org_id = i.org_id and v.id = i.invoice_id and v.status = 'draft';
  end
  $$;
grant execute on function app.clear_draft_invoice_lines(uuid) to app_user;
