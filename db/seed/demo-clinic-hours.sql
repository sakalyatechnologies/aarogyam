-- Moves the demo clinics' night-time activity into clinic hours.
-- db/seed/local.sql dates today's appointments relative to the moment it runs; seeded at night (India
-- time), they land at 1-3 am clinic time and show up on the calendar and the busy-hours heatmap.
-- A row is "at night" when its clinic-local hour is 21:00-06:59. Rows written together (same clinic,
-- created_at and night) move as one batch by whole hours, so a seeded day keeps its order and gaps and
-- lands at 10:00 onwards (details at _batch below). Rows tied to a moved row move with it: appointment
-- events, queue tokens and visits with their appointment, and a visit's notes, vitals, findings,
-- procedures and prescriptions with the visit. created_at/updated_at/deleted_at stay. Never deletes.
-- Use scripts/demo-refresh.sh --clinic-hours (dry run by default); directly:
--   psql "$OWNER_URL" -v apply=1 -f db/seed/demo-clinic-hours.sql
\set ON_ERROR_STOP 1
\if :{?apply}
\else
  \set apply 0
\endif
begin;
set local timezone = 'UTC';

create temp table _orgs on commit drop as
  select id, slug, timezone from aarogyam.organizations where slug in ('sunrise', 'lotus', 'suhasyadental');

-- Anchor rows: appointments, and tokens and visits not tied to an appointment.
create temp table _anchor on commit drop as
  select 'appointments' as tbl, a.id, a.org_id, o.timezone as tz, a.created_at, a.starts_at as t,
         greatest(a.arrived_at, a.seated_at, a.completed_at,
                  case when a.status in ('completed', 'no_show') then a.ends_at end) as happened
  from aarogyam.appointments a join _orgs o on o.id = a.org_id
  union all
  select 'queue_tokens', q.id, q.org_id, o.timezone, q.created_at, q.issued_at, greatest(q.issued_at, q.called_at, q.done_at)
  from aarogyam.queue_tokens q join _orgs o on o.id = q.org_id where q.appointment_id is null
  union all
  select 'encounters', e.id, e.org_id, o.timezone, e.created_at, e.started_at, greatest(e.started_at, e.ended_at)
  from aarogyam.encounters e join _orgs o on o.id = e.org_id where e.appointment_id is null;
-- A batch is what one transaction wrote for one night (or day): same clinic, created_at and night date.
alter table _anchor add column batch text;
update _anchor set batch = org_id || '/' || created_at || '/' || ((t at time zone tz) - interval '7 hours')::date;

-- Each batch with a night row moves as one, by whole hours, so its earliest row starts at 10:xx on the
-- day of its latest row; a day earlier if that would put something that already happened in the future.
create temp table _batch on commit drop as
  select batch, case when max(happened) + off > now() then off - interval '24 hours' else off end as off
  from (select batch, max(happened) as happened,
               make_interval(hours => (((max(t at time zone tz))::date - (min(t at time zone tz))::date) * 24
                                       + 10 - extract(hour from min(t at time zone tz)))::int) as off
        from _anchor group by batch
        having bool_or(extract(hour from t at time zone tz) >= 21 or extract(hour from t at time zone tz) < 7)) b
  group by batch, off, happened;

-- What moves, and by how much: (table, id, offset). Tied rows follow their appointment.
create temp table _move (tbl text, id uuid, off interval, primary key (tbl, id)) on commit drop;
insert into _move select a.tbl, a.id, b.off from _anchor a join _batch b using (batch);
insert into _move select 'queue_tokens', q.id, m.off from aarogyam.queue_tokens q
  join _move m on m.tbl = 'appointments' and m.id = q.appointment_id;
insert into _move select 'encounters', e.id, m.off from aarogyam.encounters e
  join _move m on m.tbl = 'appointments' and m.id = e.appointment_id;
insert into _move
  select 'appointment_events', v.id, m.off
  from aarogyam.appointment_events v join _move m on m.tbl = 'appointments' and m.id = v.appointment_id;

-- Preview: every anchor row, clinic-local, before and after.
select m.tbl, o.slug, to_char(x.t at time zone o.timezone, 'Dy DD Mon HH24:MI') as now_at,
       to_char((x.t + m.off) at time zone o.timezone, 'Dy DD Mon HH24:MI') as moves_to
from _move m
join lateral (select org_id, starts_at as t from aarogyam.appointments where id = m.id and m.tbl = 'appointments'
              union all select org_id, issued_at from aarogyam.queue_tokens where id = m.id and m.tbl = 'queue_tokens'
              union all select org_id, started_at from aarogyam.encounters where id = m.id and m.tbl = 'encounters') x on true
join _orgs o on o.id = x.org_id
order by o.slug, m.tbl, x.t;

do $$
declare
  tbl text; cols text; cnt bigint; trg record;
begin
  foreach tbl in array array['appointments', 'appointment_events', 'queue_tokens', 'encounters',
    'clinical_notes', 'observations', 'conditions', 'procedures', 'specialty_records', 'prescriptions',
    'attachments', 'treatment_plans'] loop
    continue when to_regclass('aarogyam.' || tbl) is null;
    select string_agg(format('%1$I = t.%1$I + m.off', c.column_name), ', ' order by c.ordinal_position) into cols
    from information_schema.columns c
    where c.table_schema = 'aarogyam' and c.table_name = tbl and c.data_type = 'timestamp with time zone'
      and c.column_name not in ('created_at', 'updated_at', 'deleted_at');
    continue when cols is null;
    for trg in select t.tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
               where t.tgrelid = ('aarogyam.' || tbl)::regclass and not t.tgisinternal
                 and p.proname in ('set_row_meta', 'freeze_when', 'freeze_when_final', 'forbid_change') loop
      execute format('alter table aarogyam.%I disable trigger %I', tbl, trg.tgname);
    end loop;
    if tbl in ('appointments', 'appointment_events', 'queue_tokens', 'encounters') then
      execute format('update aarogyam.%1$I t set %2$s from _move m where m.tbl = %1$L and m.id = t.id', tbl, cols);
    else -- a visit's records follow the visit
      execute format('update aarogyam.%1$I t set %2$s from _move m where m.tbl = ''encounters'' and m.id = t.encounter_id', tbl, cols);
    end if;
    get diagnostics cnt = row_count;
    if cnt > 0 then raise notice '  %: % rows', rpad(tbl, 20), cnt; end if;
    for trg in select t.tgname from pg_trigger t where t.tgrelid = ('aarogyam.' || tbl)::regclass
                 and not t.tgisinternal and t.tgenabled = 'D' loop
      execute format('alter table aarogyam.%I enable trigger %I', tbl, trg.tgname);
    end loop;
  end loop;
end $$;

-- Tokens are filed under a clinic day; flag any whose time now falls on a different day.
select count(*) as token_day_mismatch from aarogyam.queue_tokens q join _orgs o on o.id = q.org_id
where q.id in (select id from _move where tbl = 'queue_tokens') and (q.issued_at at time zone o.timezone)::date <> q.day \gset
\echo '  queue tokens whose time is now on another clinic day (check these): ' :token_day_mismatch

\if :apply
commit;
\echo 'applied'
\else
rollback;
\echo 'dry run: rolled back, nothing changed (pass --apply to change)'
\endif
