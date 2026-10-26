-- Booking conflict policy (docs/decisions.md, "A taken slot can be requested"). A patient asking
-- online for a time the doctor already holds either gets a 409 (`strict`) or files a request the
-- front desk or doctor decides (`request`, the default). The clinic default lives in
-- org_settings.booking.conflict_policy (jsonb, read with defaults, so no backfill); a doctor may
-- override it for themselves here.
-- Expand only: two columns and a wider notification-kind list.
set local lock_timeout = '5s';

-- null = follow the clinic default.
alter table aarogyam.practitioners
  add column conflict_policy text check (conflict_policy in ('request', 'strict'));

-- A requested appointment that asked for a time already held by another appointment.
alter table aarogyam.appointments
  add column requested_overlap boolean not null default false;

-- 0660's list plus booking_conflict (about an appointment, like booking_requested).
alter table aarogyam.staff_notifications
  drop constraint staff_notifications_kind_check,
  add constraint staff_notifications_kind_check check (kind in
    ('booking_requested', 'booking_confirmed_auto', 'booking_cancelled_by_patient', 'lab_overdue',
     'arrival', 'payment_due', 'recall_due', 'patient_waiting', 'send_in', 'collect_payment',
     'task_due', 'task_reminder', 'task_escalated', 'time_off_requested', 'time_off_decided',
     'stock_alert', 'booking_conflict'))
    not valid;
alter table aarogyam.staff_notifications validate constraint staff_notifications_kind_check;

-- Who sees booking_conflict: the doctor of that practitioner, and staff who are not a doctor of
-- another practitioner (front desk, assistant, owner). A doctor sees every other appointment
-- notification (appointments.read is `all`), but not a colleague's conflict. The readers
-- combine this with appointments.read and the member's reach. Always true for other kinds.
create function app.booking_conflict_visible(
  n aarogyam.staff_notifications, p_practitioner uuid, p_member uuid)
  returns boolean
  language sql stable set search_path = ''
  as $$
    select n.kind <> 'booking_conflict'
        or exists (select 1 from aarogyam.practitioners p
                   where p.org_id = n.org_id and p.id = p_practitioner
                     and p.membership_id = p_member)
        or not exists (select 1 from aarogyam.practitioners p
                       where p.org_id = n.org_id and p.membership_id = p_member
                         and p.deleted_at is null)
  $$;
grant execute on function app.booking_conflict_visible(aarogyam.staff_notifications, uuid, uuid)
  to app_user;

-- The reminder job and its steps (0320) also cover booking_conflict: an overlap request writes
-- that kind alone, so it is the one bell row and carries the same reminder cadence.
create or replace function app.open_booking_requests(p_now timestamptz, p_min_minutes int, p_limit int)
  returns table (org_id uuid, id uuid, created_at timestamptz, reminded_at timestamptz,
                 local_now time, booking jsonb)
  language sql stable security definer set search_path = ''
  as $$
    select n.org_id, n.id, n.created_at, n.reminded_at,
           app.clinic_local_time(p_now, o.timezone), coalesce(s.booking, '{}')
    from aarogyam.staff_notifications n
    join aarogyam.appointments a on a.org_id = n.org_id and a.id = n.appointment_id
    join aarogyam.organizations o on o.id = n.org_id
    left join aarogyam.org_settings s on s.org_id = n.org_id
    where n.kind in ('booking_requested', 'booking_conflict')
      and n.handled_at is null and n.escalated_at is null
      and n.created_at <= p_now - make_interval(mins => greatest(coalesce(p_min_minutes, 5), 1))
      and a.status = 'requested' and a.deleted_at is null and a.starts_at > p_now
      and o.status in ('trial', 'active')
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  $$;

-- Records one step for a booking request at p_now and leaves its inbox message, once: 'remind'
-- sets reminded_at and writes a message for the clinic; 'escalate' sets escalated_at and writes one
-- for the owners. Returns the message id, or null when the step was already taken or the
-- request was handled meanwhile.
create or replace function app.record_booking_request_step(p_org_id uuid, p_id uuid, p_step text,
                                                p_now timestamptz)
  returns uuid
  language sql volatile security definer set search_path = ''
  as $$
    with stepped as (
      update aarogyam.staff_notifications n
        set reminded_at = case when p_step = 'remind' then p_now else n.reminded_at end,
            escalated_at = case when p_step = 'escalate' then p_now else n.escalated_at end
      where n.org_id = p_org_id and n.id = p_id and n.kind in ('booking_requested', 'booking_conflict')
        and n.handled_at is null and n.escalated_at is null
        and ((p_step = 'remind' and n.reminded_at is null)
             or (p_step = 'escalate' and n.reminded_at is not null))
      returning n.org_id, n.id, n.appointment_id
    )
    insert into aarogyam.staff_inbox_messages (org_id, kind, audience, notification_id, appointment_id)
    select s.org_id,
           case when p_step = 'remind' then 'booking_reminder' else 'booking_escalation' end,
           case when p_step = 'remind' then 'clinic' else 'owners' end,
           s.id, s.appointment_id
    from stepped s
    on conflict (org_id, notification_id, kind) do nothing
    returning id
  $$;

