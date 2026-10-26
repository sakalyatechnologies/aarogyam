-- What a purchase order asks for (lines) and what has come in against it (receipts). Lines can
-- be replaced while the order is a draft, so they are ephemeral; once received against, a line
-- is kept by the receipt that points at it. A line's received quantity never passes what was
-- ordered. The unit cost is seen and set only with finance.view.
set local lock_timeout = '5s';

create table aarogyam.purchase_order_lines (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  order_id uuid not null,
  line_no smallint not null check (line_no between 1 and 100),
  item_id uuid not null,
  quantity bigint not null check (quantity between 1 and 1000000),
  unit_cost_paise bigint check (unit_cost_paise between 0 and 100000000),
  received_quantity bigint not null default 0 check (received_quantity >= 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, id, order_id),
  unique (org_id, order_id, line_no),
  unique (org_id, order_id, item_id),
  foreign key (org_id, order_id) references aarogyam.purchase_orders (org_id, id),
  foreign key (org_id, item_id) references aarogyam.inventory_items (org_id, id),
  check (received_quantity <= quantity)
);
create index purchase_order_lines_item on aarogyam.purchase_order_lines (org_id, item_id);
comment on table aarogyam.purchase_order_lines is 'sensitivity=internal offline=server_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.purchase_order_lines', 'ephemeral');

-- Stock that came in against a line: the batch it made and how many units.
create table aarogyam.purchase_order_receipts (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  order_id uuid not null,
  line_id uuid not null,
  batch_id uuid not null,
  quantity bigint not null check (quantity > 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, batch_id),
  foreign key (org_id, line_id, order_id) references aarogyam.purchase_order_lines (org_id, id, order_id),
  foreign key (org_id, batch_id) references aarogyam.stock_batches (org_id, id)
);
create index purchase_order_receipts_order on aarogyam.purchase_order_receipts (org_id, order_id);
create index purchase_order_receipts_line on aarogyam.purchase_order_receipts (org_id, line_id, order_id);
comment on table aarogyam.purchase_order_receipts is 'sensitivity=internal offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.purchase_order_receipts', 'append_only');
