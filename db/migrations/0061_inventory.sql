-- Clinic stock: what the clinic keeps (items), who it buys from (suppliers), what is on the
-- shelf by delivery (batches, with expiry and cost) and every change to it (movements).
--
-- Quantities are whole units of the item's unit. A batch's quantity can never go below zero:
-- the check is in the database, so no code path can oversell stock.
set local lock_timeout = '5s';

create table aarogyam.suppliers (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  gstin text check (gstin ~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id)
);
create unique index suppliers_name on aarogyam.suppliers (org_id, lower(name)) where deleted_at is null;
comment on table aarogyam.suppliers is 'sensitivity=internal offline=read_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.suppliers', 'soft_delete');

create table aarogyam.inventory_items (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text check (category ~ '^[a-z][a-z0-9_]{0,39}$'),
  unit text not null default 'piece' check (unit in ('piece', 'ml', 'g', 'box', 'pack')),
  -- At or below this the item is low; at a fifth of it or less, critical.
  reorder_level bigint not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id)
);
create unique index inventory_items_name on aarogyam.inventory_items (org_id, lower(name)) where deleted_at is null;
comment on table aarogyam.inventory_items is 'sensitivity=internal offline=read_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.inventory_items', 'soft_delete');

create table aarogyam.stock_batches (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  item_id uuid not null,
  supplier_id uuid,
  batch_no text check (char_length(btrim(batch_no)) between 1 and 60),
  expiry date,
  received_quantity bigint not null check (received_quantity > 0),
  -- What is left on the shelf. Never negative, never more than was received.
  quantity bigint not null check (quantity >= 0),
  unit_cost_paise bigint not null default 0 check (unit_cost_paise >= 0),
  received_on date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, item_id) references aarogyam.inventory_items (org_id, id),
  foreign key (org_id, supplier_id) references aarogyam.suppliers (org_id, id),
  check (quantity <= received_quantity)
);
create index stock_batches_item on aarogyam.stock_batches (org_id, item_id, expiry nulls last, received_on)
  where quantity > 0;
create index stock_batches_supplier on aarogyam.stock_batches (org_id, supplier_id) where supplier_id is not null;
create index stock_batches_expiry on aarogyam.stock_batches (org_id, expiry) where quantity > 0 and expiry is not null;
comment on table aarogyam.stock_batches is 'sensitivity=internal offline=read_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.stock_batches', 'mutable');

-- Only the quantity on hand changes on a batch; what was received, from whom and at what
-- cost is the delivery's record.
create function app.stock_batch_quantity_only() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if (to_jsonb(new) - array['quantity', 'updated_at', 'updated_by'])
       <> (to_jsonb(old) - array['quantity', 'updated_at', 'updated_by']) then
      raise exception 'a stock batch changes only in quantity'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end
  $$;
create trigger quantity_only before update on aarogyam.stock_batches
  for each row execute function app.stock_batch_quantity_only();

-- Every change in stock, one row per batch touched. The sign says the direction: receive adds,
-- use and expire remove, adjust is either. The history cannot be edited or deleted.
create table aarogyam.stock_movements (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  item_id uuid not null,
  batch_id uuid not null,
  kind text not null check (kind in ('receive', 'use', 'adjust', 'expire')),
  quantity bigint not null check (quantity <> 0),
  reason text check (char_length(btrim(reason)) between 1 and 300),
  created_at timestamptz not null default now(),
  -- Who did it (set by the server).
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, item_id) references aarogyam.inventory_items (org_id, id),
  foreign key (org_id, batch_id) references aarogyam.stock_batches (org_id, id),
  check ((kind = 'receive' and quantity > 0) or (kind in ('use', 'expire') and quantity < 0) or kind = 'adjust'),
  check (kind not in ('adjust', 'expire') or reason is not null)
);
create index stock_movements_item on aarogyam.stock_movements (org_id, item_id, created_at desc);
create index stock_movements_batch on aarogyam.stock_movements (org_id, batch_id);
comment on table aarogyam.stock_movements is 'sensitivity=internal offline=read_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.stock_movements', 'append_only');
