-- The clinic's notification switches (portal v2, Settings): `org_settings.notifications` already
-- holds the quiet hours and the campaign caps; it now also holds reminder_24h (default on),
-- reminder_2h (off), receipts (off), recall (on), low_stock (on) and lab_due (on). A key that is
-- missing or not a boolean means its default, so nothing changes for clinics that never touch
-- them. This migration makes the database side of each switch real:
--   reminder_24h / reminder_2h: which appointment reminders app.queue_appointment_reminders queues
--   lab_due: whether an overdue lab order writes a staff notification (0395)
--   quiet_hours.enabled = false: no quiet hours (app.message_quiet_until, used by dispatch)
-- The switches for receipts, recalls and low stock are read where those are produced. Expand
-- only: functions are replaced with the same signatures and the same results by default.
set local lock_timeout = '5s';

-- A boolean switch in a settings object, or its default when absent or not a boolean.
create function app.notification_switch(p_notifications jsonb, p_key text, p_default boolean)
  returns boolean
  language sql immutable set search_path = ''
  as $$
    select case jsonb_typeof(p_notifications -> p_key)
             when 'boolean' then (p_notifications ->> p_key)::boolean
             else p_default end
  $$;
revoke execute on function app.notification_switch(jsonb, text, boolean) from public;
grant execute on function app.notification_switch(jsonb, text, boolean) to aarogyam_api, app_user;

-- Quiet hours may be switched off: {"enabled": false, ...}.
create or replace function app.message_quiet_until(p_at timestamptz, p_timezone text,
                                                   p_notifications jsonb)
  returns timestamptz
  language plpgsql stable set search_path = ''
  as $$
  declare
    v_zone text := coalesce(nullif(p_timezone, ''), 'Asia/Kolkata');
    v_start time;
    v_end time;
    v_local timestamp;
    v_quiet boolean;
  begin
    if not app.notification_switch(p_notifications -> 'quiet_hours', 'enabled', true) then
      return null;
    end if;
    begin
      v_start := coalesce((p_notifications->'quiet_hours'->>'start')::time, time '21:00');
      v_end := coalesce((p_notifications->'quiet_hours'->>'end')::time, time '09:00');
    exception when others then
      v_start := time '21:00';
      v_end := time '09:00';
    end;
    begin
      v_local := p_at at time zone v_zone;
    exception when invalid_parameter_value then
      v_zone := 'Asia/Kolkata';
      v_local := p_at at time zone v_zone;
    end;
    v_quiet := case
      when v_start = v_end then false
      when v_start > v_end then v_local::time >= v_start or v_local::time < v_end
      else v_local::time >= v_start and v_local::time < v_end
    end;
    if not v_quiet then
      return null;
    end if;
    return ((v_local::date + (v_local::time >= v_end)::int) + v_end) at time zone v_zone;
  end
  $$;

-- Appointment reminders (0373) follow the clinic's switches. The 24 hour reminder (`:24h`) is on
-- unless switched off; the 2 hour reminder (`:2h`, variables {"lead_hours": 2}) is queued, once
-- the appointment is within 2.5 hours, only when switched on. With both on, an appointment booked
-- less than 2.5 hours ahead gets the 2 hour reminder only, not two at once.
create or replace function app.queue_appointment_reminders(p_now timestamptz, p_limit int)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with due as (
      select a.org_id, a.id, a.patient_id, a.starts_at, l.hours
      from aarogyam.appointments a
      join aarogyam.organizations o on o.id = a.org_id
      join aarogyam.patients p on p.org_id = a.org_id and p.id = a.patient_id
      left join aarogyam.org_settings s on s.org_id = a.org_id
      cross join lateral (values (24), (2)) as l(hours)
      where a.status in ('booked', 'confirmed') and a.deleted_at is null
        and o.status in ('trial', 'active')
        and p.email is not null and p.deleted_at is null and p.status in ('active', 'inactive')
        and (
          (l.hours = 24
            and a.starts_at > p_now + interval '1 hour'
            and a.starts_at <= p_now + interval '26 hours'
            and app.notification_switch(coalesce(s.notifications, '{}'), 'reminder_24h', true)
            and not (app.notification_switch(coalesce(s.notifications, '{}'), 'reminder_2h', false)
                     and a.starts_at <= p_now + interval '150 minutes'))
          or
          (l.hours = 2
            and a.starts_at > p_now + interval '10 minutes'
            and a.starts_at <= p_now + interval '150 minutes'
            and app.notification_switch(coalesce(s.notifications, '{}'), 'reminder_2h', false))
        )
        and not exists (select 1 from aarogyam.messages m
                        where m.org_id = a.org_id
                          and m.dedupe_key = 'reminder:appt:' || a.id::text || ':' || l.hours || 'h')
        and app.may_contact(a.org_id, a.patient_id, 'reminders')
      order by a.starts_at, l.hours
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    ),
    queued as (
      insert into aarogyam.messages (org_id, patient_id, channel, kind, purpose, template_key,
                                     variables, appointment_id, dedupe_key, scheduled_for)
      select d.org_id, d.patient_id, 'email', 'appointment.reminder', 'reminders',
             'appointment.reminder',
             case when d.hours = 2 then '{"lead_hours": 2}'::jsonb else '{}'::jsonb end,
             d.id, 'reminder:appt:' || d.id::text || ':' || d.hours || 'h',
             greatest(p_now, d.starts_at - make_interval(hours => d.hours))
      from due d
      on conflict (org_id, dedupe_key) do nothing
      returning 1
    )
    select count(*)::int from queued
  $$;

-- An overdue lab order tells the clinic's staff (0395) unless the clinic switched `lab_due` off.
-- Work that comes back, is cancelled or gets a new due date still handles an open alert.
create or replace function app.lab_order_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if old.overdue_flagged_on is null and new.overdue_flagged_on is not null
       and new.due_on is not null
       and app.notification_switch(
             (select s.notifications from aarogyam.org_settings s where s.org_id = new.org_id),
             'lab_due', true) then
      insert into aarogyam.staff_notifications (org_id, kind, lab_order_id, lab_due_on)
      values (new.org_id, 'lab_overdue', new.id, new.due_on)
      on conflict (org_id, lab_order_id, lab_due_on) where lab_order_id is not null do nothing;
    end if;
    if new.status not in ('sent', 'in_progress') or new.due_on is distinct from old.due_on then
      update aarogyam.staff_notifications n
        set handled_at = now(), handled_by = app.chat_member_id()
      where n.org_id = new.org_id and n.lab_order_id = new.id and n.handled_at is null;
    end if;
    return null;
  end
  $$;
