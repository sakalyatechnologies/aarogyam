-- Change history: who changed which row, and what changed.
--
-- A record, not an application log: written by a trigger in the same transaction as the
-- change, so it can't miss a change or record one that rolled back. To keep it small:
--   insert  who and when only (the row itself holds the values; later updates hold the history)
--   update  changed columns only, as {"column": [old, new]}; updates that change nothing are skipped
--   delete  the old values (only ephemeral rows can be deleted)
-- Columns listed in audit.audit_config are left out (`exclude`) or recorded without their
-- values (`mask`). Partitioned by month; old months are archived, not kept forever.
set local lock_timeout = '5s';

create table audit.audit_config (
  id uuid primary key default app.uuid_v7(),
  table_name text not null unique check (table_name ~ '^[a-z_]+\.[a-z_]+$'),
  exclude text[] not null default '{}',
  mask text[] not null default '{}',
  metadata_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table audit.audit_config enable row level security;
create trigger set_row_times before insert or update on audit.audit_config
  for each row execute function app.set_row_times();
comment on table audit.audit_config is 'sensitivity=internal offline=server_only lifecycle=mutable';

create table audit.audit_events (
  id uuid not null default app.uuid_v7(),
  at timestamptz not null default now(),
  org_id uuid,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_user_id uuid,
  actor_kind text,
  changes jsonb,
  request_id text,
  primary key (id, at)
) partition by range (at);
create index audit_events_row on audit.audit_events (org_id, table_name, row_id, at desc);
alter table audit.audit_events enable row level security;
comment on table audit.audit_events is 'sensitivity=health offline=server_only lifecycle=append_only';

-- Clinic owners may read their clinic's history; nobody writes it except the trigger.
create policy same_clinic on audit.audit_events for select to app_user
  using (org_id = (select app.tenant_id()));
grant select on audit.audit_events to app_user;

create trigger forbid_change before update or delete on audit.audit_events
  for each row execute function app.forbid_change();

create function app.audit_row() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  declare
    tbl text := tg_table_schema || '.' || tg_table_name;
    cfg_exclude text[] := '{}';
    cfg_mask text[] := '{}';
    cfg_metadata_only boolean := false;
    old_row jsonb;
    new_row jsonb;
    row_json jsonb;
    changes jsonb;
    col text;
  begin
    select c.exclude, c.mask, c.metadata_only
      into cfg_exclude, cfg_mask, cfg_metadata_only
      from audit.audit_config c where c.table_name = tbl;
    cfg_exclude := coalesce(cfg_exclude, '{}') || array['created_at', 'created_by', 'updated_at', 'updated_by'];
    cfg_mask := coalesce(cfg_mask, '{}');

    if tg_op in ('UPDATE', 'DELETE') then old_row := to_jsonb(old); end if;
    if tg_op in ('INSERT', 'UPDATE') then new_row := to_jsonb(new); end if;
    row_json := coalesce(new_row, old_row);

    if tg_op = 'UPDATE' then
      changes := '{}';
      for col in select jsonb_object_keys(new_row) loop
        continue when col = any(cfg_exclude);
        if (old_row -> col) is distinct from (new_row -> col) then
          changes := changes || jsonb_build_object(col,
            case when col = any(cfg_mask) then to_jsonb('changed'::text)
                 else jsonb_build_array(old_row -> col, new_row -> col) end);
        end if;
      end loop;
      if changes = '{}' then
        return null;
      end if;
    elsif tg_op = 'DELETE' and not coalesce(cfg_metadata_only, false) then
      select jsonb_object_agg(key, case when key = any(cfg_mask) then to_jsonb('masked'::text) else value end)
        into changes
        from jsonb_each(old_row)
        where not key = any(cfg_exclude);
    end if;

    if coalesce(cfg_metadata_only, false) then
      changes := null;
    end if;

    insert into audit.audit_events (org_id, table_name, row_id, action, actor_user_id, actor_kind, changes, request_id)
    values (
      (row_json ->> 'org_id')::uuid,
      tbl,
      (row_json ->> 'id')::uuid,
      lower(tg_op),
      app.user_id(),
      app.actor_kind(),
      changes,
      app.request_id()
    );
    return null;
  end
  $$;

-- Monthly partitions from this month to `months_ahead` months ahead, plus a default
-- partition that catches anything outside them (an alert should watch it stay empty).
-- Run monthly by the worker or pg_cron; safe to run repeatedly.
create function app.ensure_partitions(parent regclass, months_ahead int default 12) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    parent_schema text;
    parent_name text;
    first_month date := date_trunc('month', now() at time zone 'UTC')::date;
    month date;
    part text;
  begin
    select n.nspname, c.relname into parent_schema, parent_name
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.oid = parent;

    if not exists (select from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = parent_schema and c.relname = parent_name || '_default') then
      execute format('create table %I.%I partition of %I.%I default',
                     parent_schema, parent_name || '_default', parent_schema, parent_name);
    end if;

    for i in 0 .. months_ahead loop
      month := (first_month + make_interval(months => i))::date;
      part := parent_name || '_' || to_char(month, 'YYYY_MM');
      if not exists (select from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = parent_schema and c.relname = part) then
        execute format('create table %I.%I partition of %I.%I for values from (%L) to (%L)',
                       parent_schema, part, parent_schema, parent_name,
                       month::timestamp at time zone 'UTC',
                       (month + interval '1 month')::timestamp at time zone 'UTC');
      end if;
    end loop;
  end
  $$;

select app.ensure_partitions('audit.audit_events');
