-- Optimistic concurrency for the records people edit from more than one device: a counter that
-- goes up when a record's content changes. A client reads it (the API sends it as the ETag),
-- sends it back in If-Match with its edit, and the API refuses the edit with 412 when the
-- record has changed since.
set local lock_timeout = '5s';

-- Bumps row_version when the row's content changes. Columns named as arguments are bookkeeping
-- the system updates by itself (a visit setting a patient's last visit, a recording marking a
-- note as voice) or a generated column, which a BEFORE trigger sees unset: changing only them doesn't make anyone's edit stale. An update that changes
-- nothing leaves the version alone.
create function app.bump_row_version() returns trigger
  language plpgsql set search_path = ''
  as $$
  declare
    ignored text[] := array['row_version', 'updated_at', 'updated_by'] || tg_argv;
  begin
    if (to_jsonb(old) - ignored) is distinct from (to_jsonb(new) - ignored) then
      new.row_version := old.row_version + 1;
    else
      new.row_version := old.row_version;
    end if;
    return new;
  end
  $$;
revoke execute on function app.bump_row_version() from public;

alter table aarogyam.patients add column row_version bigint not null default 1;
alter table aarogyam.appointments add column row_version bigint not null default 1;
alter table aarogyam.clinical_notes add column row_version bigint not null default 1;

-- Triggers run in name order: row_version comes after freeze_when_final, which compares the old
-- and new rows before the bump, and before set_row_meta.
create trigger row_version before update on aarogyam.patients
  for each row execute function app.bump_row_version('last_visit_at', 'search_name');
create trigger row_version before update on aarogyam.appointments
  for each row execute function app.bump_row_version();
create trigger row_version before update on aarogyam.clinical_notes
  for each row execute function app.bump_row_version('source');

-- The counter is bookkeeping, not a change to the record: leave it out of the change history.
insert into audit.audit_config (table_name, exclude) values
  ('aarogyam.patients', '{row_version}'),
  ('aarogyam.appointments', '{row_version}'),
  ('aarogyam.clinical_notes', '{row_version}')
on conflict (table_name) do update
  set exclude = array(select distinct unnest(audit.audit_config.exclude || '{row_version}'::text[]));
