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
