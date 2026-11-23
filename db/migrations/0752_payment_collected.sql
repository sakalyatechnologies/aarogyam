-- payment_collected: the desk recorded a payment on a bill whose visit was sent for payment
-- (it has a collect_payment row); the visit's doctor is told. Expand only.
--   * The row is about the bill (invoice_id), like collect_payment, plus the amount of the
--     latest payment (amount_paise). Ids and an amount only: no names, phones or diagnoses.
--     The visit and patient come from the bill when the feed is read.
--   * One row per bill and kind (staff_notifications_invoice): a further payment on the same
--     bill updates the amount and makes the row new again (unread, pushed again).
--   * Seen only by the visit's doctor (encounters.clinician_id), never by billing readers.
set local lock_timeout = '5s';

alter table aarogyam.staff_notifications
  add column amount_paise bigint check (amount_paise is null or amount_paise > 0),
  drop constraint staff_notifications_kind_check,
  drop constraint staff_notifications_invoice_subject,
  add constraint staff_notifications_kind_check check (kind in
    ('booking_requested', 'booking_confirmed_auto', 'booking_cancelled_by_patient', 'lab_overdue',
     'arrival', 'payment_due', 'recall_due', 'patient_waiting', 'send_in', 'collect_payment',
     'task_due', 'task_reminder', 'task_escalated', 'time_off_requested', 'time_off_decided',
     'stock_alert', 'booking_conflict', 'plan_response', 'payment_collected')) not valid,
  add constraint staff_notifications_invoice_subject
    check ((kind in ('payment_due', 'collect_payment', 'payment_collected'))
           = (invoice_id is not null)) not valid,
  add constraint staff_notifications_amount_subject
    check ((kind = 'payment_collected') = (amount_paise is not null)) not valid;
alter table aarogyam.staff_notifications validate constraint staff_notifications_kind_check;
alter table aarogyam.staff_notifications validate constraint staff_notifications_invoice_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_amount_subject;

-- Tells the visit's doctor that p_amount was paid on the bill, when the bill's visit was sent
-- for payment (a collect_payment row exists) and the doctor is not the one recording it.
-- Returns how many rows were written or renewed (0 or 1).
create function app.write_payment_collected(
  p_org uuid, p_invoice uuid, p_amount bigint, p_recorder uuid)
  returns int
  language sql volatile set search_path = ''
  as $$
    with due as (
      select i.org_id, i.id, i.patient_id
      from aarogyam.invoices i
      join aarogyam.encounters e on e.org_id = i.org_id and e.id = i.encounter_id
      where i.org_id = p_org and i.id = p_invoice and p_amount > 0
        and e.clinician_id is not null and e.clinician_id is distinct from p_recorder
        and exists (select 1 from aarogyam.staff_notifications c
                    where c.org_id = i.org_id and c.invoice_id = i.id and c.kind = 'collect_payment')
    ),
    saved as (
      insert into aarogyam.staff_notifications (org_id, kind, invoice_id, amount_paise, href, audience)
      select d.org_id, 'payment_collected', d.id, p_amount, '/patients/' || d.patient_id::text, 'doctor'
      from due d
      on conflict (org_id, invoice_id, kind) where invoice_id is not null do update
        set amount_paise = excluded.amount_paise, handled_at = null, handled_by = null,
            pushed_at = null, reminded_at = now()
      returning org_id, id
    ),
    cleared as (
      delete from aarogyam.staff_notification_reads r
      using saved
      where r.org_id = saved.org_id and r.notification_id = saved.id
      returning 1
    )
    select count(*)::int from saved
  $$;
grant execute on function app.write_payment_collected(uuid, uuid, bigint, uuid) to app_user;

-- Who sees it: the doctor of the bill's visit. False for every other kind.
create function app.payment_collected_visible(n aarogyam.staff_notifications, p_member uuid)
  returns boolean
  language sql stable set search_path = ''
  as $$
    select n.kind = 'payment_collected' and exists (
      select 1 from aarogyam.invoices i
      join aarogyam.encounters e on e.org_id = i.org_id and e.id = i.encounter_id
      where i.org_id = n.org_id and i.id = n.invoice_id and e.clinician_id = p_member)
  $$;
grant execute on function app.payment_collected_visible(aarogyam.staff_notifications, uuid)
  to app_user;
