-- Moves the demo clinics' dated activity forward so it centres on today again.
-- Demo data (db/seed/local.sql, demo-billing.sql, and whatever was entered since) is dated relative to
-- the day it was added; this shifts every dated row of the demo clinics by whole days, the same for
-- all of them, so order, durations and weekdays are unchanged. Never deletes rows; run it as the owner.
-- Use scripts/demo-refresh.sh (dry run by default); directly:
--   psql "$OWNER_URL" -v apply=1 [-v exact=1] -f db/seed/demo-refresh.sql
-- Shift = whole weeks (multiple of 7) from the latest appointment day to today, so the weekday of every
-- appointment stays; -v exact=1 shifts by exactly that many days instead (latest day lands on today).
-- Never more than keeps every past event in the past. A shift of 0 does nothing, so it is safe daily.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?exact}
\else
  \set exact 0
\endif
begin;
set local timezone = 'UTC';

create temp table _demo_orgs on commit drop as
  select id, slug from aarogyam.organizations where slug in ('sunrise', 'lotus', 'suhasyadental');

-- Days from the latest appointment (clinic-local date) to today, capped so that nothing already
-- happened (bills, receipts, arrivals, visits) lands in the future.
select coalesce((with anchor as (
  select (select max((starts_at at time zone 'Asia/Kolkata')::date) from aarogyam.appointments
          where org_id in (select id from _demo_orgs)) as latest_day,
         (select max(t) from (
            select max(issued_at) t from aarogyam.invoices where org_id in (select id from _demo_orgs)
            union all select max(received_at) from aarogyam.payments where org_id in (select id from _demo_orgs)
            union all select max(started_at) from aarogyam.encounters where org_id in (select id from _demo_orgs)
            union all select max(issued_at) from aarogyam.queue_tokens where org_id in (select id from _demo_orgs)
            union all select max(arrived_at) from aarogyam.appointments where org_id in (select id from _demo_orgs)
            union all select max(completed_at) from aarogyam.appointments where org_id in (select id from _demo_orgs)
          ) x) as latest_event
), days as (
  select least(
           (now() at time zone 'Asia/Kolkata')::date - latest_day,
           coalesce(floor(extract(epoch from now() - latest_event) / 86400)::int, 1000000)) as d
  from anchor where latest_day is not null
)
select case when :exact::int = 1 then greatest(d, 0) else greatest(d, 0) / 7 * 7 end from days), 0) as shift_days \gset
select :shift_days > 0 as go, set_config('demo.shift', :'shift_days', true) as _ \gset
select 'demo clinics: ' || coalesce(string_agg(slug, ', ' order by slug), 'none found') || '; shift: ' || :shift_days || ' days'
from _demo_orgs;

\if :go
do $$
declare
  n int := current_setting('demo.shift')::int;
  step interval := make_interval(days => n);
  sq record;
  cols text;
  d date;
  cnt bigint;
  tbl text;
  trg record;
  touched text[] := '{}';
begin
  -- Tables whose dated columns move. Every date and timestamp column of these moves, except birth
  -- dates. Tables that do not exist (yet) are skipped.
  foreach tbl in array array[
    'appointments', 'appointment_events', 'queue_tokens', 'leave_blocks', 'teleconsult_sessions',
    'encounters', 'clinical_notes', 'note_addenda', 'observations', 'conditions', 'allergies',
    'medical_history_items', 'prescriptions', 'prescription_items', 'prescription_alerts', 'procedures',
    'treatment_plans', 'treatment_plan_items', 'attachments', 'specialty_records', 'consent_forms',
    'invoices', 'invoice_items', 'payments', 'payment_allocations', 'refunds', 'expenses', 'daily_closings',
    'lab_orders', 'lab_payments', 'recalls', 'stock_batches', 'stock_movements', 'share_links', 'patients']
  loop
    continue when to_regclass('aarogyam.' || tbl) is null;
    select string_agg(format('%1$I = %1$I + %2$s', c.column_name,
                             case c.data_type when 'date' then n::text else quote_literal(step::text) || '::interval' end),
                      ', ' order by c.ordinal_position)
      into cols
    from information_schema.columns c
    where c.table_schema = 'aarogyam' and c.table_name = tbl
      and c.data_type in ('date', 'timestamp with time zone')
      and c.column_name not in ('date_of_birth');
    continue when cols is null or not exists (select 1 from information_schema.columns
                                              where table_schema = 'aarogyam' and table_name = tbl and column_name = 'org_id');
    -- Let the row meta, freeze and append-only guards step aside for this transaction only.
    for trg in select t.tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
               where t.tgrelid = ('aarogyam.' || tbl)::regclass and not t.tgisinternal
                 and p.proname in ('set_row_meta', 'freeze_when', 'freeze_when_final', 'freeze_with_parent',
                                   'forbid_change', 'stock_batch_quantity_only', 'attachment_note_frozen') loop
      execute format('alter table aarogyam.%I disable trigger %I', tbl, trg.tgname);
    end loop;
    if tbl = 'queue_tokens' then
      -- (branch, day, token number) is unique: move the latest days first so none lands on another.
      cnt := 0;
      for d in select distinct day from aarogyam.queue_tokens where org_id in (select id from _demo_orgs) order by day desc loop
        execute format('update aarogyam.%I set %s where org_id in (select id from _demo_orgs) and day = $1', tbl, cols) using d;
        get diagnostics n := row_count; cnt := cnt + n;
      end loop;
      n := current_setting('demo.shift')::int;
    else
      execute format('update aarogyam.%I set %s where org_id in (select id from _demo_orgs)', tbl, cols);
      get diagnostics cnt = row_count;
    end if;
    if cnt > 0 then raise notice '  %: % rows', rpad(tbl, 22), cnt; end if;
  end loop;

  -- Per-day queue numbering follows the tokens to their new day (local date as period), latest first.
  cnt := 0;
  for sq in select org_id, series, period from aarogyam.number_sequences
           where kind = 'queue_token' and period <> '' and org_id in (select id from _demo_orgs)
           order by period desc loop
    update aarogyam.number_sequences set period = (sq.period::date + n)::text
    where org_id = sq.org_id and kind = 'queue_token' and series = sq.series and period = sq.period;
    cnt := cnt + 1;
  end loop;
  if cnt > 0 then raise notice '  %: % rows', rpad('number_sequences', 22), cnt; end if;
end
$$;

-- Keep today's story straight: nothing in the past is still waiting to happen.
with gone as (
  update aarogyam.appointments a set
    status = case when a.status = 'requested' then 'cancelled'
                  when a.status in ('booked', 'confirmed') then 'no_show' else 'completed' end,
    cancel_reason = case when a.status = 'requested' then 'Not confirmed in time' else a.cancel_reason end,
    arrived_at = case when a.status in ('arrived', 'in_chair') then coalesce(a.arrived_at, a.starts_at - interval '5 minutes') else a.arrived_at end,
    seated_at = case when a.status in ('arrived', 'in_chair') then coalesce(a.seated_at, a.starts_at) else a.seated_at end,
    completed_at = case when a.status in ('arrived', 'in_chair') then coalesce(a.completed_at, a.ends_at) else a.completed_at end,
    updated_at = now()
  from aarogyam.appointments o
  where o.org_id = a.org_id and o.id = a.id
    and a.org_id in (select id from _demo_orgs) and a.ends_at < now() and a.deleted_at is null
    and a.status in ('requested', 'booked', 'confirmed', 'arrived', 'in_chair')
  returning a.org_id, a.id, o.status as from_status, a.status as to_status, a.ends_at
), ev as (
  insert into aarogyam.appointment_events (org_id, appointment_id, kind, from_status, to_status, note, at)
  select org_id, id, 'status', from_status, to_status, 'Demo refresh', ends_at from gone
  returning 1
)
select count(*) as fixed_appointments from gone \gset
\echo '  appointments left open in the past, closed out: ' :fixed_appointments

with done as (
  update aarogyam.queue_tokens q set
    status = 'done',
    called_at = coalesce(q.called_at, q.issued_at),
    done_at = least(coalesce(q.done_at, (select a.completed_at from aarogyam.appointments a where a.org_id = q.org_id and a.id = q.appointment_id),
                             coalesce(q.called_at, q.issued_at) + interval '30 minutes'), now()),
    updated_at = now()
  where q.org_id in (select id from _demo_orgs) and q.status in ('waiting', 'in_chair')
    and (q.day < (now() at time zone 'Asia/Kolkata')::date
         or exists (select 1 from aarogyam.appointments a
                    where a.org_id = q.org_id and a.id = q.appointment_id and a.status in ('completed', 'no_show', 'cancelled')))
  returning 1
)
select count(*) as fixed_tokens from done \gset
\echo '  queue tokens still waiting in the past, closed out: ' :fixed_tokens

-- Put the guards back before anything else runs in this transaction.
do $$
declare r record;
begin
  for r in select c.oid::regclass as tbl, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_proc p on p.oid = t.tgfoid
           where t.tgenabled = 'D' and not t.tgisinternal and c.relnamespace = 'aarogyam'::regnamespace
             and p.proname in ('set_row_meta', 'freeze_when', 'freeze_when_final', 'freeze_with_parent',
                               'forbid_change', 'stock_batch_quantity_only', 'attachment_note_frozen') loop
    execute format('alter table %s enable trigger %I', r.tbl, r.tgname);
  end loop;
end $$;
\else
\echo 'nothing to do: the demo data already centres on today'
\endif

\if :apply
commit;
\echo 'applied'
\else
rollback;
\echo 'dry run: rolled back, nothing changed (pass --apply to change)'
\endif
