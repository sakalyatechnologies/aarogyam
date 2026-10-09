-- Appointment reminders (see 0370): a step of the outbox job queues one email per booked or
-- confirmed appointment, to be sent about 24 hours before it starts. The dedupe key
-- `reminder:appt:<id>:24h` makes the step safe to run every few minutes and from several
-- workers at once. Consent, opt-outs, quiet hours and whether the appointment still stands are
-- checked again when the reminder is sent (app.message_dispatch).
set local lock_timeout = '5s';

-- The step's scan: upcoming booked or confirmed appointments, across clinics.
create index appointments_upcoming on aarogyam.appointments (starts_at)
  where status in ('booked', 'confirmed') and deleted_at is null;

-- Queues reminders for appointments starting between an hour and 26 hours after p_now, at
-- clinics in use, whose patient has an email and consents to reminders; each is scheduled 24
-- hours before its appointment (or now, if that has passed). Returns how many were queued.
create function app.queue_appointment_reminders(p_now timestamptz, p_limit int)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with due as (
      select a.org_id, a.id, a.patient_id, a.starts_at
      from aarogyam.appointments a
      join aarogyam.organizations o on o.id = a.org_id
      join aarogyam.patients p on p.org_id = a.org_id and p.id = a.patient_id
      where a.status in ('booked', 'confirmed') and a.deleted_at is null
        and a.starts_at > p_now + interval '1 hour'
        and a.starts_at <= p_now + interval '26 hours'
        and o.status in ('trial', 'active')
        and p.email is not null and p.deleted_at is null and p.status in ('active', 'inactive')
        and not exists (select 1 from aarogyam.messages m
                        where m.org_id = a.org_id
                          and m.dedupe_key = 'reminder:appt:' || a.id::text || ':24h')
        and app.may_contact(a.org_id, a.patient_id, 'reminders')
      order by a.starts_at
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    ),
    queued as (
      insert into aarogyam.messages (org_id, patient_id, channel, kind, purpose, template_key,
                                     appointment_id, dedupe_key, scheduled_for)
      select d.org_id, d.patient_id, 'email', 'appointment.reminder', 'reminders',
             'appointment.reminder', d.id, 'reminder:appt:' || d.id::text || ':24h',
             greatest(p_now, d.starts_at - interval '24 hours')
      from due d
      on conflict (org_id, dedupe_key) do nothing
      returning 1
    )
    select count(*)::int from queued
  $$;
revoke execute on function app.queue_appointment_reminders(timestamptz, int) from public;
grant execute on function app.queue_appointment_reminders(timestamptz, int) to aarogyam_api;
