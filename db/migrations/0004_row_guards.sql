-- Row triggers shared by every table.
set local lock_timeout = '5s';

-- created_at / created_by / updated_at / updated_by on clinic tables. The server decides
-- these, whatever the client sends; created_* never change after insert.
create function app.set_row_meta() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if tg_op = 'INSERT' then
      new.created_at := now();
      new.created_by := app.user_id();
    else
      new.created_at := old.created_at;
      new.created_by := old.created_by;
    end if;
    new.updated_at := now();
    new.updated_by := app.user_id();
    return new;
  end
  $$;

-- created_at / updated_at on platform and user tables, which have no *_by columns.
create function app.set_row_times() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if tg_op = 'INSERT' then
      new.created_at := now();
    else
      new.created_at := old.created_at;
    end if;
    new.updated_at := now();
    return new;
  end
  $$;

-- Append-only tables: no grant allows UPDATE or DELETE, and this trigger also stops the owner.
create function app.forbid_change() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    raise exception '%.% is append-only', tg_table_schema, tg_table_name
      using errcode = 'insufficient_privilege';
  end
  $$;

-- Applies the standard protection to a clinic table: row-level security limited to the
-- current clinic, grants that follow its lifecycle, and the meta, audit and append-only
-- triggers. Every clinic table is created and then passed through this, so none is missed.
--   mutable, soft_delete, finalizable  select, insert, update
--   append_only                        select, insert (and updates or deletes raise)
--   ephemeral                          select, insert, update, delete
-- `audited` is false only for counters whose history is the documents they number.
create function app.protect_clinic_table(target regclass, lifecycle text, audited boolean default true)
  returns void
  language plpgsql set search_path = ''
  as $$
  begin
    if lifecycle not in ('mutable', 'soft_delete', 'finalizable', 'append_only', 'ephemeral') then
      raise exception 'unknown lifecycle %', lifecycle;
    end if;

    execute format('alter table %s enable row level security', target);
    execute format('create policy same_clinic on %s to app_user
                    using (org_id = (select app.tenant_id()))
                    with check (org_id = (select app.tenant_id()))', target);

    execute format('grant select, insert on %s to app_user', target);
    if lifecycle in ('mutable', 'soft_delete', 'finalizable', 'ephemeral') then
      execute format('grant update on %s to app_user', target);
    end if;
    if lifecycle = 'ephemeral' then
      execute format('grant delete on %s to app_user', target);
    end if;

    execute format('create trigger set_row_meta before insert or update on %s
                    for each row execute function app.set_row_meta()', target);
    if lifecycle = 'append_only' then
      execute format('create trigger forbid_change before update or delete on %s
                      for each row execute function app.forbid_change()', target);
    end if;
    if audited then
      execute format('create trigger audit after insert or update or delete on %s
                      for each row execute function app.audit_row()', target);
    end if;
  end
  $$;
