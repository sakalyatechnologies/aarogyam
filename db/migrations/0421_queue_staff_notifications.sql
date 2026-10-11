-- Staff notifications about the queue (docs/flows/clinic-visit-flow.md): `patient_waiting` for the
-- token's doctor, `send_in` for the front desk when the doctor calls a patient, `collect_payment`
-- for the front desk and finance when the token is ready to bill. A notification is now about an
-- appointment, a lab order or a queue token, exactly one. Written in the transaction that moves
-- the token. Who sees one is decided when reading (see audience); IDs only, never a name: the
-- clinic number comes from the token's patient when shown. Expand only.
set local lock_timeout = '5s';

alter table aarogyam.staff_notifications
  add column queue_token_id uuid,
  -- doctor: the token's doctor; front_desk: whoever has appointments.write; billing: whoever
  -- has billing.write or finance.view. Null for booking and lab notifications.
  add column audience text,
  drop constraint staff_notifications_kind_check,
  add constraint staff_notifications_kind_check check (kind in
    ('booking_requested', 'booking_confirmed_auto', 'booking_cancelled_by_patient', 'lab_overdue',
     'patient_waiting', 'send_in', 'collect_payment')) not valid,
  drop constraint staff_notifications_one_subject,
  add constraint staff_notifications_one_subject
    check (num_nonnulls(appointment_id, lab_order_id, queue_token_id) = 1) not valid,
  add constraint staff_notifications_queue_subject
    check ((kind in ('patient_waiting', 'send_in', 'collect_payment')) = (queue_token_id is not null)
           and (queue_token_id is null) = (audience is null)
           and (audience is null or audience in ('doctor', 'front_desk', 'billing'))) not valid,
  add constraint staff_notifications_queue_token_fk
    foreign key (org_id, queue_token_id) references aarogyam.queue_tokens (org_id, id) not valid;
alter table aarogyam.staff_notifications validate constraint staff_notifications_kind_check;
alter table aarogyam.staff_notifications validate constraint staff_notifications_one_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_queue_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_queue_token_fk;
-- Also the foreign key's index.
create index staff_notifications_queue_token
  on aarogyam.staff_notifications (org_id, queue_token_id) where queue_token_id is not null;
