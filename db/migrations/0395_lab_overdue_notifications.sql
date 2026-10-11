-- Lab overdue alerts on the staff notifications feed (docs/decisions.md, "Labs" and "Clinic
-- notifications"). Expand only: a notification is now about an appointment or a lab order,
-- exactly one. The reminder job's overdue step (overdue_flagged_on, 0363) writes one
-- `lab_overdue` per order and due date; who sees it is decided when reading, by `labs.read` and
-- its scope (app.clinical_in_reach), as bookings are by `appointments.read`. IDs only.
set local lock_timeout = '5s';

alter table aarogyam.staff_notifications
  add column lab_order_id uuid,
  -- The due date the order was overdue on: a new due date can be overdue again.
  add column lab_due_on date,
  alter column appointment_id drop not null,
  drop constraint staff_notifications_kind_check,
  add constraint staff_notifications_kind_check check (kind in
    ('booking_requested', 'booking_confirmed_auto', 'booking_cancelled_by_patient', 'lab_overdue'))
    not valid,
  add constraint staff_notifications_one_subject
    check (num_nonnulls(appointment_id, lab_order_id) = 1) not valid,
  add constraint staff_notifications_lab_subject
    check ((kind = 'lab_overdue') = (lab_order_id is not null)
           and (lab_order_id is null) = (lab_due_on is null)) not valid,
  add constraint staff_notifications_lab_order_fk
    foreign key (org_id, lab_order_id) references aarogyam.lab_orders (org_id, id) not valid;
alter table aarogyam.staff_notifications validate constraint staff_notifications_kind_check;
alter table aarogyam.staff_notifications validate constraint staff_notifications_one_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_lab_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_lab_order_fk;
-- One alert per order and due date; also the foreign key's index.
create unique index staff_notifications_lab_order
  on aarogyam.staff_notifications (org_id, lab_order_id, lab_due_on) where lab_order_id is not null;

-- The overdue step flags an order once per due date: tell the clinic, once. Work that comes back,
-- is cancelled or gets a new due date handles the open alert.
create function app.lab_order_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if old.overdue_flagged_on is null and new.overdue_flagged_on is not null
       and new.due_on is not null then
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
create trigger lab_order_notify
  after update of overdue_flagged_on, status, due_on on aarogyam.lab_orders
  for each row
  when (old.overdue_flagged_on is distinct from new.overdue_flagged_on
        or old.status is distinct from new.status or old.due_on is distinct from new.due_on)
  execute function app.lab_order_notify();
