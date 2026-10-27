-- Purchase orders: what the clinic orders from a supplier. An order is a draft until it is
-- sent (ordered), then received (in whole or in parts) or cancelled. Receiving goes through the
-- same path as a delivery recorded by hand: each unit received becomes a stock batch and a
-- `receive` movement, and the order remembers which batch came from which line
-- (0688). Line costs are seen and set only with finance.view.
set local lock_timeout = '5s';

alter table aarogyam.number_sequences drop constraint number_sequences_kind_check;
alter table aarogyam.number_sequences add constraint number_sequences_kind_check
  check (kind in ('patient', 'visit', 'invoice', 'prescription', 'receipt', 'lab_order',
                  'queue_token', 'purchase_order'));

create table aarogyam.purchase_orders (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  -- PO-1, PO-2, ... per clinic.
  number text not null check (number ~ '^PO-[0-9]{1,9}$'),
  supplier_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'ordered', 'received', 'cancelled')),
  expected_on date,
  notes text check (char_length(btrim(notes)) between 1 and 1000),
  ordered_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, number),
  foreign key (org_id, supplier_id) references aarogyam.suppliers (org_id, id),
  check (status in ('draft', 'cancelled') or ordered_at is not null),
  check ((status = 'received') = (received_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index purchase_orders_supplier on aarogyam.purchase_orders (org_id, supplier_id);
create index purchase_orders_status on aarogyam.purchase_orders (org_id, status, created_at desc)
  where deleted_at is null;
comment on table aarogyam.purchase_orders is 'sensitivity=internal offline=server_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.purchase_orders', 'soft_delete');
