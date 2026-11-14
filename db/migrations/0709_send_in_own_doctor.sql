-- A doctor who sends in their own patient needs no alert about it: when the person who moves
-- the token to `called` (or into the chair) is the token's own practitioner, the send_in row is
-- written already handled. It stays as muted history in the feed, and handled rows don't count
-- as unread (app.notification_counts_unread). When the desk calls the token the row is
-- unread for the doctor, as before. Only the send_in insert changes.
set local lock_timeout = '5s';

create or replace function app.queue_token_notify() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if new.status = 'called' or (old.status = 'waiting' and new.status = 'in_chair') then
      insert into aarogyam.staff_notifications
        (org_id, kind, queue_token_id, href, audience, handled_at, handled_by)
      select new.org_id, 'send_in', new.id, '/queue', 'doctor',
             case when own.is_own then now() end,
             case when own.is_own then app.chat_member_id() end
      from (select exists (
              select 1 from aarogyam.practitioners p
              where p.org_id = new.org_id and p.id = new.practitioner_id
                and p.membership_id is not distinct from app.chat_member_id()
                and p.membership_id is not null) as is_own) own
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
