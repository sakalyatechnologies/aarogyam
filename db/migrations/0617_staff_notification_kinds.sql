-- More staff notification kinds, each with a link into the portal (portal v2, bell; the staff
-- apps' in-app list):
--   arrival          a booked patient arrived (about an appointment; href /queue)
--   payment_due      a bill was issued and still has a balance (about an invoice; href
--                    /billing/invoices/<id>)
--   recall_due       a patient's follow-up fell due (about a recall; href /patients/<patient id>)
--   patient_waiting  a queue token has waited a while (about the token; href /queue)
--   send_in          the doctor called a patient in (about the token; href /queue)
--   collect_payment  a visit closed with a bill still in draft (about the invoice; href
--                    /billing/invoices/<id>)
-- Expand only: columns are added and the kind and subject checks widened; existing rows and
-- readers are unchanged. `href` is a path inside the portal chosen by whoever writes the row,
-- never a name or a diagnosis. Who sees a row is decided when reading: arrival with
-- appointments.read (as bookings), payment_due with billing.read, recall_due with patients.read
-- and its scope (app.patient_in_reach). Rows are written by triggers in the transaction of the
-- change (arrival, bill issued) or by the reminder job (recall_due, app.flag_due_recalls) and
-- handled by the change that settles them (patient moves on, bill paid or voided, recall done).
set local lock_timeout = '5s';

alter table aarogyam.staff_notifications
  add column href text check (href is null or href ~ '^/[A-Za-z0-9/_.?=&%-]{0,199}$'),
  add column invoice_id uuid,
  add column recall_id uuid,
  add column queue_token_id uuid,
  drop constraint staff_notifications_kind_check,
  drop constraint staff_notifications_one_subject,
  add constraint staff_notifications_kind_check check (kind in
    ('booking_requested', 'booking_confirmed_auto', 'booking_cancelled_by_patient', 'lab_overdue',
     'arrival', 'payment_due', 'recall_due', 'patient_waiting', 'send_in', 'collect_payment'))
    not valid,
  add constraint staff_notifications_one_subject
    check (num_nonnulls(appointment_id, lab_order_id, invoice_id, recall_id, queue_token_id) = 1) not valid,
  add constraint staff_notifications_invoice_subject
    check ((kind in ('payment_due', 'collect_payment')) = (invoice_id is not null)) not valid,
  add constraint staff_notifications_recall_subject
    check ((kind = 'recall_due') = (recall_id is not null)) not valid,
  add constraint staff_notifications_queue_subject
    check ((kind in ('patient_waiting', 'send_in')) = (queue_token_id is not null)) not valid,
  add constraint staff_notifications_queue_token_fk
    foreign key (org_id, queue_token_id) references aarogyam.queue_tokens (org_id, id) not valid,
  add constraint staff_notifications_invoice_fk
    foreign key (org_id, invoice_id) references aarogyam.invoices (org_id, id) not valid,
  add constraint staff_notifications_recall_fk
    foreign key (org_id, recall_id) references aarogyam.recalls (org_id, id) not valid;
alter table aarogyam.staff_notifications validate constraint staff_notifications_kind_check;
alter table aarogyam.staff_notifications validate constraint staff_notifications_one_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_invoice_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_recall_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_queue_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_queue_token_fk;
alter table aarogyam.staff_notifications validate constraint staff_notifications_invoice_fk;
alter table aarogyam.staff_notifications validate constraint staff_notifications_recall_fk;

-- One alert per bill and kind, per recall, per queue token and kind, and per arrival of an
-- appointment.
create unique index staff_notifications_invoice
  on aarogyam.staff_notifications (org_id, invoice_id, kind) where invoice_id is not null;
create unique index staff_notifications_queue_token
  on aarogyam.staff_notifications (org_id, queue_token_id, kind) where queue_token_id is not null;
create unique index staff_notifications_recall
  on aarogyam.staff_notifications (org_id, recall_id) where recall_id is not null;
create unique index staff_notifications_arrival
  on aarogyam.staff_notifications (org_id, appointment_id) where kind = 'arrival';

-- Recalls are deleted when their patient is erased (0345): their alerts go first.
insert into audit.erasure_steps (table_name, step_order, action, filter, note) values
  ('aarogyam.staff_notifications', 55, 'delete',
   'recall_id in (select r.id from aarogyam.recalls r where r.patient_id = $2)',
   'recall alerts; booking, bill and lab alerts hold ids only and stay');

-- A patient arrives (the appointment becomes `arrived`, also when it is created as such): tell
-- the clinic. When they move on, the alert is handled.
create function app.appointment_arrival_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if new.status = 'arrived' and (tg_op = 'INSERT' or old.status is distinct from 'arrived') then
      insert into aarogyam.staff_notifications (org_id, kind, appointment_id, href)
      values (new.org_id, 'arrival', new.id, '/queue')
      on conflict (org_id, appointment_id) where kind = 'arrival' do nothing;
    elsif tg_op = 'UPDATE' and old.status = 'arrived' and new.status <> 'arrived' then
      update aarogyam.staff_notifications n
        set handled_at = now(), handled_by = app.chat_member_id()
      where n.org_id = new.org_id and n.appointment_id = new.id and n.kind = 'arrival'
        and n.handled_at is null;
    end if;
    return null;
  end
  $$;
create trigger appointment_arrival_notify
  after insert or update of status on aarogyam.appointments
  for each row execute function app.appointment_arrival_notify();

-- A bill is issued with something to pay: tell the clinic; paying it in full, or voiding it,
-- handles the alert.
create function app.invoice_payment_due_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if new.status = 'issued' and old.status = 'draft' and new.total_paise > 0 then
      -- A visit that closed with this bill in draft already asked for the money.
      insert into aarogyam.staff_notifications (org_id, kind, invoice_id, href)
      select new.org_id, 'payment_due', new.id, '/billing/invoices/' || new.id::text
      where not exists (select 1 from aarogyam.staff_notifications n
                        where n.org_id = new.org_id and n.invoice_id = new.id)
      on conflict (org_id, invoice_id, kind) where invoice_id is not null do nothing;
    elsif new.status = 'void' and old.status <> 'void' then
      update aarogyam.staff_notifications n
        set handled_at = now(), handled_by = app.chat_member_id()
      where n.org_id = new.org_id and n.invoice_id = new.id and n.handled_at is null;
    end if;
    return null;
  end
  $$;
create trigger invoice_payment_due_notify
  after update of status on aarogyam.invoices
  for each row execute function app.invoice_payment_due_notify();

create function app.payment_allocation_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    update aarogyam.staff_notifications n
      set handled_at = now(), handled_by = app.chat_member_id()
    from aarogyam.invoices i
    where n.org_id = new.org_id and n.invoice_id = new.invoice_id and n.handled_at is null
      and i.org_id = n.org_id and i.id = n.invoice_id
      and i.total_paise <= (select coalesce(sum(a.amount_paise), 0)
                            from aarogyam.payment_allocations a
                            join aarogyam.payments m on m.org_id = a.org_id and m.id = a.payment_id
                            where a.org_id = i.org_id and a.invoice_id = i.id
                              and m.status = 'received');
    return null;
  end
  $$;
create trigger payment_allocation_notify
  after insert on aarogyam.payment_allocations
  for each row execute function app.payment_allocation_notify();

-- A visit closes while its bill is still a draft: tell the clinic to collect, once per bill.
create function app.encounter_collect_payment_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    insert into aarogyam.staff_notifications (org_id, kind, invoice_id, href)
    select i.org_id, 'collect_payment', i.id, '/billing/invoices/' || i.id::text
    from aarogyam.invoices i
    where i.org_id = new.org_id and i.encounter_id = new.id and i.status = 'draft'
    on conflict (org_id, invoice_id, kind) where invoice_id is not null do nothing;
    return null;
  end
  $$;
create trigger encounter_collect_payment_notify
  after update of status on aarogyam.encounters
  for each row when (old.status = 'open' and new.status = 'closed')
  execute function app.encounter_collect_payment_notify();

-- The doctor sends a waiting or called patient in: tell the clinic. When the patient leaves the chair (or the
-- queue), the alerts about the token are handled.
create function app.queue_token_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if old.status in ('waiting', 'called') and new.status = 'in_chair' then
      insert into aarogyam.staff_notifications (org_id, kind, queue_token_id, href)
      values (new.org_id, 'send_in', new.id, '/queue')
      on conflict (org_id, queue_token_id, kind) where queue_token_id is not null do nothing;
    end if;
    if new.status in ('done', 'left') or (old.status = 'waiting' and new.status <> 'waiting') then
      update aarogyam.staff_notifications n
        set handled_at = now(), handled_by = app.chat_member_id()
      where n.org_id = new.org_id and n.queue_token_id = new.id and n.handled_at is null
        and (n.kind = 'patient_waiting' or new.status in ('done', 'left'));
    end if;
    return null;
  end
  $$;
create trigger queue_token_notify
  after update of status on aarogyam.queue_tokens
  for each row when (old.status is distinct from new.status)
  execute function app.queue_token_notify();

-- The reminder job's step across clinics at p_now: a token still waiting after p_min_minutes,
-- on its own day, at a clinic in use, writes one `patient_waiting` alert, once. Returns how many.
create function app.flag_waiting_tokens(p_now timestamptz, p_min_minutes int, p_limit int)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with due as (
      select q.org_id, q.id
      from aarogyam.queue_tokens q
      join aarogyam.organizations o on o.id = q.org_id and o.status in ('trial', 'active')
      where q.status = 'waiting' and q.day = app.clinic_local_date(p_now, o.timezone)
        and q.issued_at <= p_now - make_interval(mins => greatest(coalesce(p_min_minutes, 15), 1))
        and not exists (select 1 from aarogyam.staff_notifications n
                        where n.org_id = q.org_id and n.queue_token_id = q.id
                          and n.kind = 'patient_waiting')
      order by q.issued_at, q.id
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    ),
    written as (
      insert into aarogyam.staff_notifications (org_id, kind, queue_token_id, href)
      select d.org_id, 'patient_waiting', d.id, '/queue' from due d
      on conflict (org_id, queue_token_id, kind) where queue_token_id is not null do nothing
      returning 1
    )
    select count(*)::int from written
  $$;
revoke execute on function app.flag_waiting_tokens(timestamptz, int, int) from public;
grant execute on function app.flag_waiting_tokens(timestamptz, int, int) to aarogyam_api;

-- A recall that is booked, done or dismissed handles its alert.
create function app.recall_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    update aarogyam.staff_notifications n
      set handled_at = now(), handled_by = app.chat_member_id()
    where n.org_id = new.org_id and n.recall_id = new.id and n.handled_at is null;
    return null;
  end
  $$;
create trigger recall_notify
  after update of status on aarogyam.recalls
  for each row when (new.status in ('booked', 'done', 'dismissed') and old.status <> new.status)
  execute function app.recall_notify();

-- The reminder job's step across clinics at p_now: a recall due today or earlier, still open,
-- at a clinic in use that has not switched `recall` off, writes one alert, once. Returns how
-- many were written.
create function app.flag_due_recalls(p_now timestamptz, p_limit int)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with due as (
      select r.org_id, r.id, r.patient_id
      from aarogyam.recalls r
      join aarogyam.organizations o on o.id = r.org_id and o.status in ('trial', 'active')
      left join aarogyam.org_settings s on s.org_id = r.org_id
      where r.status = 'due' and r.due_on <= app.clinic_local_date(p_now, o.timezone)
        and app.notification_switch(coalesce(s.notifications, '{}'), 'recall', true)
        and not exists (select 1 from aarogyam.staff_notifications n
                        where n.org_id = r.org_id and n.recall_id = r.id)
      order by r.due_on, r.id
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    ),
    written as (
      insert into aarogyam.staff_notifications (org_id, kind, recall_id, href)
      select d.org_id, 'recall_due', d.id, '/patients/' || d.patient_id::text from due d
      on conflict (org_id, recall_id) where recall_id is not null do nothing
      returning 1
    )
    select count(*)::int from written
  $$;
revoke execute on function app.flag_due_recalls(timestamptz, int) from public;
grant execute on function app.flag_due_recalls(timestamptz, int) to aarogyam_api;
