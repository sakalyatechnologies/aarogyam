-- The price list, and the guards every finalised document (bills, payments, prescriptions)
-- shares: once issued, a row changes only on its way to void or cancelled, and its lines
-- never change.
set local lock_timeout = '5s';

-- Freezes a document once it leaves its editable status. Arguments: the editable status
-- ('' when the document is never editable), the terminal status, then the columns that may
-- change on the one move to the terminal status (its reason, when and who). Everything else,
-- and every later change, raises.
create function app.freeze_when_final() returns trigger
  language plpgsql set search_path = ''
  as $$
  declare
    editable text := tg_argv[0];
    terminal text := tg_argv[1];
    allowed text[] := array['status', 'updated_at', 'updated_by'] || tg_argv[2:tg_nargs - 1];
  begin
    if old.status = editable then
      return new;
    end if;
    if old.status <> terminal and new.status = terminal
       and (to_jsonb(new) - allowed) = (to_jsonb(old) - allowed) then
      return new;
    end if;
    raise exception '%.% row % is final', tg_table_schema, tg_table_name, old.id
      using errcode = 'insufficient_privilege';
  end
  $$;

-- Lines of a document change only while the document is a draft. Arguments: the parent
-- table and the column naming the parent.
create function app.freeze_with_parent() returns trigger
  language plpgsql set search_path = ''
  as $$
  declare
    parent_status text;
    line jsonb;
  begin
    foreach line in array array[case when tg_op <> 'INSERT' then to_jsonb(old) end,
                                case when tg_op <> 'DELETE' then to_jsonb(new) end] loop
      continue when line is null;
      execute format('select status from %s where org_id = $1 and id = $2', tg_argv[0]::regclass)
        into parent_status
        using (line ->> 'org_id')::uuid, (line ->> tg_argv[1])::uuid;
      if parent_status is distinct from 'draft' then
        raise exception '%.% belongs to a final document', tg_table_schema, tg_table_name
          using errcode = 'insufficient_privilege';
      end if;
    end loop;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end
  $$;

create table aarogyam.price_items (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  code text check (code ~ '^[A-Za-z0-9_-]{1,32}$'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  -- For the revenue mix: consultation, preventive, restorative, endodontics, medicines …
  category text check (category ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- SAC for services (9993 health care), HSN for goods.
  sac_hsn text check (sac_hsn ~ '^[0-9]{4,8}$'),
  price_paise bigint not null check (price_paise >= 0),
  -- Health care by a clinical establishment is exempt (rate 0, not taxable); medicines and
  -- products sold over the counter are taxable at their rate.
  taxable boolean not null default false,
  tax_rate_bps int not null default 0 check (tax_rate_bps in (0, 500, 1200, 1800)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id),
  check (taxable or tax_rate_bps = 0)
);
create unique index price_items_code on aarogyam.price_items (org_id, code)
  where code is not null and deleted_at is null;
create index price_items_name on aarogyam.price_items (org_id, name) where deleted_at is null;
comment on table aarogyam.price_items is 'sensitivity=internal offline=read_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.price_items', 'soft_delete');
