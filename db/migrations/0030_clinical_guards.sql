-- Guards for clinical records that become final: signed notes, recorded vitals, chart entries
-- and completed procedures never change. A correction is a new row; the old row may only move
-- to an allowed status (signed -> entered_in_error, final -> corrected), and nothing else on it
-- may change. The application checks first and explains; this trigger is the backstop.
set local lock_timeout = '5s';

-- Trigger arguments:
--   0  the status column
--   1  comma-separated statuses in which a row is final
--   2  comma-separated allowed moves out of a final status, as from>to
--   3  comma-separated columns that may change together with an allowed move (optional)
-- updated_at and updated_by are set by set_row_meta and always ignored.
create function app.freeze_when() returns trigger
  language plpgsql set search_path = ''
  as $$
  declare
    status_column text := tg_argv[0];
    final_statuses text[] := string_to_array(tg_argv[1], ',');
    moves text[] := string_to_array(tg_argv[2], ',');
    move_columns text[] := coalesce(string_to_array(nullif(tg_argv[3], ''), ','), '{}');
    old_status text := to_jsonb(old) ->> status_column;
    new_status text := to_jsonb(new) ->> status_column;
    ignored text[] := array['updated_at', 'updated_by', status_column] || move_columns;
  begin
    if not (old_status = any (final_statuses)) then
      return new;
    end if;
    if (to_jsonb(old) - ignored) is distinct from (to_jsonb(new) - ignored) then
      raise exception '%.% row is final (%): it can''t change', tg_table_schema, tg_table_name, old_status
        using errcode = 'insufficient_privilege';
    end if;
    if new_status is distinct from old_status then
      if not (old_status || '>' || new_status = any (moves)) then
        raise exception '%.% row is final: % can''t become %', tg_table_schema, tg_table_name, old_status, new_status
          using errcode = 'insufficient_privilege';
      end if;
    elsif (to_jsonb(old) - array['updated_at', 'updated_by']) is distinct from
          (to_jsonb(new) - array['updated_at', 'updated_by']) then
      raise exception '%.% row is final (%): it can''t change', tg_table_schema, tg_table_name, old_status
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end
  $$;
revoke execute on function app.freeze_when() from public;

-- Opening a visit is recorded in the access record as its own kind of resource.
alter table audit.access_log drop constraint access_log_resource_check;
alter table audit.access_log add constraint access_log_resource_check
  check (resource in ('chart', 'visit', 'note', 'attachment', 'prescription', 'invoice', 'export'));
