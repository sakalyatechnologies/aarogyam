-- Staff notifications for the visit journey (docs/decisions.md, "Visit notifications"): the
-- doctor is told when a patient is waiting or was called in, the desk when there is money to
-- collect, and handled rows stop counting as unread. Written by triggers in the transaction of
-- the change, once per subject (the unique indexes of 0617); who sees a row is decided when it
-- is read (app.visit_notification_visible), so a rota change takes effect at once.
--   * patient_waiting is written when a token is created waiting (it was written after a 15
--     minute wait; app.flag_waiting_tokens stays as a safety net for tokens that predate this).
--     It is handled when the token leaves waiting; a token put back to waiting reopens it.
--   * send_in is written when the token becomes `called` (it was written at `in_chair`).
--   * arrival is no longer written: a check-in already writes patient_waiting. The kind stays
--     valid for old rows, and an old row is still handled when the patient moves on.
--   * collect_payment is written for a bill with a balance when its visit's token reaches
--     ready_to_bill, when such a bill is started for a visit whose token is already there, and
--     by the app when a visit without a token is sent for payment (app.write_collect_payment).
--     Its subject stays the bill; the token is found through the visit. It handles the bill's
--     payment_due row, so the bell shows one entry. It is handled by payment in full (0617),
--     a void, or the token becoming done or left. Choosing Done writes none: the encounter
--     trigger of 0617 is dropped.
-- `audience` records who the row was written for (`doctor`, `front_desk`); the readers decide
-- visibility, the column is for clients that group or filter.
-- Rows carry ids and numbers only: never a name. Expand only: no existing row changes meaning
-- except that handled actionable rows no longer count as unread.
set local lock_timeout = '5s';

alter table aarogyam.staff_notifications
  add column audience text check (audience is null or audience in ('doctor', 'front_desk', 'billing'));

update aarogyam.staff_notifications set audience = 'doctor'
  where kind in ('patient_waiting', 'send_in') and audience is null;
update aarogyam.staff_notifications set audience = 'front_desk'
  where kind = 'collect_payment' and audience is null;

-- What a bill is worth and what is left on it. Issued: the stored total less received
-- allocations. Draft: the lines' taxable value plus GST (an intra-state split is rounded per
-- half, as the app does), rounded to the rupee; an inter-state bill can differ by a paisa before
-- rounding. Void: nothing. Never stored: the bell reads these.
create function app.invoice_total_paise(i aarogyam.invoices)
  returns bigint
  language sql stable set search_path = ''
  as $$
    select case
      when i.status = 'void' then 0::bigint
      when i.status = 'issued' then i.total_paise
      else (select coalesce(round(sum(
                    greatest(it.quantity::bigint * it.unit_price_paise - it.discount_paise, 0)
                    + 2 * floor(greatest(it.quantity::bigint * it.unit_price_paise - it.discount_paise, 0)
                                * (it.tax_rate_bps / 2) / 10000.0 + 0.5)) / 100.0) * 100, 0)::bigint
            from aarogyam.invoice_items it
            where it.org_id = i.org_id and it.invoice_id = i.id)
    end
  $$;
grant execute on function app.invoice_total_paise(aarogyam.invoices) to app_user;

create function app.invoice_balance_paise(i aarogyam.invoices)
  returns bigint
  language sql stable set search_path = ''
  as $$
    select case
      when i.status = 'void' then 0::bigint
      when i.status = 'issued' then greatest(i.total_paise - coalesce(
        (select sum(a.amount_paise)
         from aarogyam.payment_allocations a
         join aarogyam.payments m on m.org_id = a.org_id and m.id = a.payment_id
         where a.org_id = i.org_id and a.invoice_id = i.id and m.status = 'received'), 0), 0)
      else app.invoice_total_paise(i)
    end
  $$;
grant execute on function app.invoice_balance_paise(aarogyam.invoices) to app_user;

-- Writes `collect_payment` for the draft or issued bills of a visit that still have a balance,
-- once per bill, and handles the bill's payment_due row. Returns how many were written. Run by
-- the triggers below and by the app when a visit without a token is sent for payment.
create function app.write_collect_payment(p_org uuid, p_encounter_id uuid)
  returns int
  language sql volatile set search_path = ''
  as $$
    with due as (
      select i.org_id, i.id
      from aarogyam.invoices i
      where i.org_id = p_org and i.encounter_id = p_encounter_id
        and i.status in ('draft', 'issued') and app.invoice_balance_paise(i) > 0
    ),
    written as (
      insert into aarogyam.staff_notifications (org_id, kind, invoice_id, href, audience)
      select d.org_id, 'collect_payment', d.id, '/billing/invoices/' || d.id::text, 'front_desk'
      from due d
      on conflict (org_id, invoice_id, kind) where invoice_id is not null do nothing
      returning org_id, invoice_id
    ),
    superseded as (
      update aarogyam.staff_notifications n
        set handled_at = now(), handled_by = app.chat_member_id()
      from written w
      where n.org_id = w.org_id and n.invoice_id = w.invoice_id and n.kind = 'payment_due'
        and n.handled_at is null
      returning 1
    )
    select count(*)::int from written
  $$;
grant execute on function app.write_collect_payment(uuid, uuid) to app_user;

-- A check-in no longer writes `arrival`: the token it creates writes patient_waiting. An old
-- arrival is still handled when the patient moves on.
create or replace function app.appointment_arrival_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if tg_op = 'UPDATE' and old.status = 'arrived' and new.status <> 'arrived' then
      update aarogyam.staff_notifications n
        set handled_at = now(), handled_by = app.chat_member_id()
      where n.org_id = new.org_id and n.appointment_id = new.id and n.kind = 'arrival'
        and n.handled_at is null;
    end if;
    return null;
  end
  $$;

-- A patient joins the queue (walk-in or check-in): tell the doctor straight away.
create function app.queue_token_insert_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if new.status = 'waiting' then
      insert into aarogyam.staff_notifications (org_id, kind, queue_token_id, href, audience)
      values (new.org_id, 'patient_waiting', new.id, '/queue', 'doctor')
      on conflict (org_id, queue_token_id, kind) where queue_token_id is not null do nothing;
    end if;
    return null;
  end
  $$;
create trigger queue_token_insert_notify
  after insert on aarogyam.queue_tokens
  for each row execute function app.queue_token_insert_notify();

-- The token moves: `called` (or straight to the chair) writes send_in; a token that leaves
-- waiting handles patient_waiting; one put back to waiting reopens it; ready_to_bill asks the
-- desk to collect; done or left handle everything about the token and its visit's bills.
create or replace function app.queue_token_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if new.status = 'called' or (old.status = 'waiting' and new.status = 'in_chair') then
      insert into aarogyam.staff_notifications (org_id, kind, queue_token_id, href, audience)
      values (new.org_id, 'send_in', new.id, '/queue', 'doctor')
      on conflict (org_id, queue_token_id, kind) where queue_token_id is not null do nothing;
    end if;
    if new.status = 'waiting' then
      update aarogyam.staff_notifications n
        set handled_at = null, handled_by = null
      where n.org_id = new.org_id and n.queue_token_id = new.id and n.kind = 'patient_waiting'
        and n.handled_at is not null;
    end if;
    if new.status = 'ready_to_bill' then
      perform app.write_collect_payment(e.org_id, e.id)
        from aarogyam.encounters e
        where e.org_id = new.org_id and e.queue_token_id = new.id;
    end if;
    if new.status in ('done', 'left') or (old.status = 'waiting' and new.status <> 'waiting') then
      update aarogyam.staff_notifications n
        set handled_at = now(), handled_by = app.chat_member_id()
      where n.org_id = new.org_id and n.queue_token_id = new.id and n.handled_at is null
        and (n.kind = 'patient_waiting' or new.status in ('done', 'left'));
    end if;
    if new.status in ('done', 'left') then
      update aarogyam.staff_notifications n
        set handled_at = now(), handled_by = app.chat_member_id()
      from aarogyam.encounters e, aarogyam.invoices i
      where e.org_id = new.org_id and e.queue_token_id = new.id
        and i.org_id = e.org_id and i.encounter_id = e.id
        and n.org_id = i.org_id and n.invoice_id = i.id
        and n.kind in ('collect_payment', 'payment_due') and n.handled_at is null;
    end if;
    return null;
  end
  $$;

-- Choosing Done writes no collect_payment: the doctor collects the money themselves.
drop trigger encounter_collect_payment_notify on aarogyam.encounters;
drop function app.encounter_collect_payment_notify();

-- A bill gets lines while its visit's token is already ready_to_bill (the desk bills a visit
-- the doctor sent over without a fee): ask to collect. The lines come after the bill row, so
-- this runs per line; once written, the rest do nothing.
create function app.invoice_item_collect_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    perform app.write_collect_payment(i.org_id, i.encounter_id)
      from aarogyam.invoices i
      join aarogyam.encounters e on e.org_id = i.org_id and e.id = i.encounter_id
      join aarogyam.queue_tokens q on q.org_id = e.org_id and q.id = e.queue_token_id
      where i.org_id = new.org_id and i.id = new.invoice_id and q.status = 'ready_to_bill';
    return null;
  end
  $$;
create trigger invoice_item_collect_notify
  after insert on aarogyam.invoice_items
  for each row execute function app.invoice_item_collect_notify();

-- The safety net for tokens that predate the insert trigger.
create or replace function app.flag_waiting_tokens(p_now timestamptz, p_min_minutes int, p_limit int)
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
      insert into aarogyam.staff_notifications (org_id, kind, queue_token_id, href, audience)
      select d.org_id, 'patient_waiting', d.id, '/queue', 'doctor' from due d
      on conflict (org_id, queue_token_id, kind) where queue_token_id is not null do nothing
      returning 1
    )
    select count(*)::int from written
  $$;

-- Who sees a visit notification, decided when it is read.
--   * patient_waiting, send_in (about a token): the member of the practitioner the token is
--     assigned to. An unassigned token goes to the doctors on duty at its branch that day
--     (p_doctor: the member holds clinical.write): a practitioner with a member, an active
--     working_hours row for the token's weekday at the token's branch, and no leave block or
--     approved time off covering now. When nobody is on duty, to every clinical.write holder.
--     An assigned practitioner who has no member to tell falls back the same way. The token's
--     day is the clinic's local date, so the weekday needs no time zone.
--   * collect_payment (about a bill): holders of billing.write or payments.collect (p_collect).
-- False for every other kind; the readers combine this with their own rules.
create function app.visit_notification_visible(
  n aarogyam.staff_notifications, p_member uuid, p_doctor boolean, p_collect boolean)
  returns boolean
  language sql stable set search_path = ''
  as $$
    select case
      when n.kind = 'collect_payment' then p_collect
      when n.kind in ('patient_waiting', 'send_in') then
        exists (
          select 1 from aarogyam.queue_tokens q
          where q.org_id = n.org_id and q.id = n.queue_token_id
            and case
              when q.practitioner_id is not null then
                exists (select 1 from aarogyam.practitioners a
                        where a.org_id = q.org_id and a.id = q.practitioner_id
                          and a.membership_id = p_member)
                or (p_doctor and not exists (
                      select 1 from aarogyam.practitioners a
                      where a.org_id = q.org_id and a.id = q.practitioner_id
                        and a.membership_id is not null))
              else
                p_doctor and coalesce((
                  select bool_or(pr.membership_id = p_member)
                  from aarogyam.practitioners pr
                  where pr.org_id = q.org_id and pr.membership_id is not null
                    and pr.active and pr.deleted_at is null
                    and exists (select 1 from aarogyam.working_hours w
                                where w.org_id = pr.org_id and w.practitioner_id = pr.id
                                  and w.branch_id = q.branch_id
                                  and w.weekday = extract(isodow from q.day)::int)
                    and not exists (select 1 from aarogyam.leave_blocks l
                                    where l.org_id = pr.org_id and l.practitioner_id = pr.id
                                      and l.starts_at <= now() and l.ends_at > now())
                    and not exists (select 1 from aarogyam.time_off_requests t
                                    where t.org_id = pr.org_id and t.membership_id = pr.membership_id
                                      and t.status = 'approved'
                                      and t.starts_at <= now() and t.ends_at > now())), true)
            end)
      else false
    end
  $$;
grant execute on function app.visit_notification_visible(
  aarogyam.staff_notifications, uuid, boolean, boolean) to app_user;

-- Whether a row still counts towards the bell: a handled actionable row (someone already acted)
-- does not. Booking and lab rows are unchanged: handled ones still count until read.
create function app.notification_counts_unread(n aarogyam.staff_notifications)
  returns boolean
  language sql immutable set search_path = ''
  as $$
    select n.handled_at is null
        or n.kind not in ('patient_waiting', 'send_in', 'collect_payment', 'arrival', 'payment_due')
  $$;
grant execute on function app.notification_counts_unread(aarogyam.staff_notifications) to app_user;
