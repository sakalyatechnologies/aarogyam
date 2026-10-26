-- Automatic no-shows and day-end queue clean-up (docs/decisions.md, "No-shows are automatic and
-- reversible", "Day-end token close"). A drain job moves a Booked or Confirmed appointment to
-- no_show once its end plus the clinic's grace has passed and the patient never got a queue
-- token, and leaves a `missed_visit` follow-up for the front desk. A second job closes tokens
-- left open on an earlier clinic day. Settings live in org_settings.booking (jsonb, read with
-- defaults, so no backfill): no_show_auto (default true), no_show_grace_minutes (default 30,
-- 0 to 240).
-- Expand only: two nullable columns and two functions.
set local lock_timeout = '5s';

-- The follow-up this appointment caused, once (the partial unique index makes a re-run a no-op).
alter table aarogyam.recalls add column source_appointment_id uuid;
alter table aarogyam.recalls
  add constraint recalls_source_appointment_fk
  foreign key (org_id, source_appointment_id) references aarogyam.appointments (org_id, id);
create unique index recalls_source_appointment
  on aarogyam.recalls (org_id, source_appointment_id, kind)
  where source_appointment_id is not null;

-- Why a token was closed without the patient being seen ('Closed at day end').
alter table aarogyam.queue_tokens
  add column left_reason text check (char_length(left_reason) <= 200);

-- One guarded statement: the appointment, its history row and its follow-up change together or
-- not at all. Rows another transaction holds (a check-in in progress) are skipped and met on the
-- next run; a check-in that wins the race leaves a token, which the update re-checks.
create function app.auto_no_show(p_now timestamptz, p_limit int)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with due as (
      select a.org_id, a.id, a.status as old_status, a.patient_id, a.starts_at, o.timezone
      from aarogyam.appointments a
      join aarogyam.organizations o on o.id = a.org_id and o.status in ('trial', 'active')
      left join aarogyam.org_settings s on s.org_id = a.org_id
      where a.status in ('booked', 'confirmed') and a.deleted_at is null
        and coalesce(case when jsonb_typeof(s.booking -> 'no_show_auto') = 'boolean'
                          then (s.booking ->> 'no_show_auto')::boolean end, true)
        and a.ends_at + make_interval(mins => least(greatest(
              coalesce(case when jsonb_typeof(s.booking -> 'no_show_grace_minutes') = 'number'
                            then (s.booking ->> 'no_show_grace_minutes')::numeric::int end, 30),
              0), 240)) < p_now
        and not exists (select 1 from aarogyam.queue_tokens q
                        where q.org_id = a.org_id and q.appointment_id = a.id)
      order by a.ends_at, a.id
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
      for update of a skip locked
    ),
    moved as (
      update aarogyam.appointments a
        set status = 'no_show', updated_at = now()
      from due d
      where a.org_id = d.org_id and a.id = d.id
        and a.status in ('booked', 'confirmed')
        and not exists (select 1 from aarogyam.queue_tokens q
                        where q.org_id = a.org_id and q.appointment_id = a.id)
      returning a.org_id, a.id, a.patient_id, a.starts_at, d.old_status, d.timezone
    ),
    logged as (
      insert into aarogyam.appointment_events (org_id, appointment_id, kind, from_status,
                                               to_status, note, at, created_by)
      select m.org_id, m.id, 'status', m.old_status, 'no_show', 'auto_no_show', p_now, null
      from moved m
      returning 1
    ),
    followed as (
      insert into aarogyam.recalls (org_id, patient_id, kind, reason, due_on,
                                    source_appointment_id)
      select m.org_id, m.patient_id, 'missed_visit', 'Missed appointment',
             app.clinic_local_date(m.starts_at, m.timezone), m.id
      from moved m
      on conflict (org_id, source_appointment_id, kind) where source_appointment_id is not null
        do nothing
      returning 1
    )
    select count(*)::int from moved
  $$;
revoke execute on function app.auto_no_show(timestamptz, int) from public;
grant execute on function app.auto_no_show(timestamptz, int) to aarogyam_api;

-- Tokens of an earlier clinic day that never finished (waiting, called, in the chair) leave the
-- queue. ready_to_bill stays open: money is still to collect. Run in batches, so a first run
-- over a long backlog does not hold locks for long.
create function app.close_stale_tokens(p_now timestamptz, p_limit int)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with stale as (
      select q.org_id, q.id
      from aarogyam.queue_tokens q
      join aarogyam.organizations o on o.id = q.org_id and o.status in ('trial', 'active')
      where q.status in ('waiting', 'called', 'in_chair')
        and q.day < app.clinic_local_date(p_now, o.timezone)
      order by q.day, q.id
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
      for update of q skip locked
    ),
    closed as (
      update aarogyam.queue_tokens q
        set status = 'left', done_at = p_now, left_reason = 'Closed at day end',
            updated_at = now()
      from stale s
      where q.org_id = s.org_id and q.id = s.id and q.status in ('waiting', 'called', 'in_chair')
      returning 1
    )
    select count(*)::int from closed
  $$;
revoke execute on function app.close_stale_tokens(timestamptz, int) from public;
grant execute on function app.close_stale_tokens(timestamptz, int) to aarogyam_api;
