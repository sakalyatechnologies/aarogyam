-- Lab reminders (docs/decisions.md, "Labs"). The outbox job emails the lab when work is due in
-- two days and on the day, and flags work that is overdue; each step once per due date (the
-- per-day columns, cleared when the due date changes), whatever runs at once. A reminder goes
-- to a lab contact, not a patient, so it uses the outbox with `recipient` set. It names the
-- clinic, the order number, the work, teeth, shade and due date, never the patient.
set local lock_timeout = '5s';

-- The clinic's calendar day at p_at; India's when the clinic's zone is unknown to Postgres.
create function app.clinic_local_date(p_at timestamptz, p_timezone text)
  returns date
  language plpgsql stable set search_path = ''
  as $$
  begin
    return (p_at at time zone p_timezone)::date;
  exception when invalid_parameter_value then
    return (p_at at time zone 'Asia/Kolkata')::date;
  end
  $$;

-- What a reminder email says, for one order: no patient field exists to leak.
create function app.lab_reminder_payload(p_org_id uuid, p_order_id uuid, p_reminder text)
  returns jsonb
  language sql stable set search_path = ''
  as $$
    select jsonb_build_object(
      'clinic_name', g.name, 'order_number', o.number, 'due_on', o.due_on::text,
      'reminder', p_reminder,
      'items', coalesce((select jsonb_agg(jsonb_build_object('work_type', i.work_type,
                                                             'teeth', to_jsonb(i.teeth),
                                                             'shade', i.shade) order by i.line_no)
                         from aarogyam.lab_order_items i
                         where i.org_id = o.org_id and i.lab_order_id = o.id), '[]'::jsonb))
    from aarogyam.lab_orders o
    join aarogyam.organizations g on g.id = o.org_id
    where o.org_id = p_org_id and o.id = p_order_id
  $$;

-- Where a reminder goes: the order's contact when they have an email, else the lab's first
-- contact with one. No row when the lab has no email at all.
create function app.lab_reminder_email(p_org_id uuid, p_order_id uuid)
  returns table (contact_id uuid, email text)
  language sql stable set search_path = ''
  as $$
    select c.id, c.email
    from aarogyam.lab_orders o
    join aarogyam.lab_contacts c on c.org_id = o.org_id and c.vendor_id = o.vendor_id
    where o.org_id = p_org_id and o.id = p_order_id
      and c.deleted_at is null and c.email is not null
    order by (c.id is not distinct from o.contact_id) desc, c.created_at, c.id
    limit 1
  $$;

-- One reminder run across clinics at p_now (the job's clock), while each clinic's own clock is
-- between 09:00 and 20:00. Each step is a conditional update of its per-day column, so a
-- second run, or one running at the same time, finds nothing to do. Returns one row per step
-- taken, with the queued message (null for an overdue flag or a lab without an email).
create function app.run_lab_reminders(p_now timestamptz, p_limit int)
  returns table (org_id uuid, lab_order_id uuid, step text, message_id uuid)
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    r record;
    v_email text;
  begin
    for r in
      select x.* from (
        select o.org_id, o.id, o.due_on, o.due_soon_reminded_on, o.due_today_reminded_on,
               o.overdue_flagged_on, app.clinic_local_date(p_now, g.timezone) as today
        from aarogyam.lab_orders o
        join aarogyam.organizations g on g.id = o.org_id
        where o.status in ('sent', 'in_progress') and o.due_on <= (p_now)::date + 3
          and g.status in ('trial', 'active')
          and app.clinic_local_time(p_now, g.timezone) between time '09:00' and time '20:00'
      ) x
      where (x.due_on < x.today and x.overdue_flagged_on is null)
         or (x.due_on = x.today and x.due_today_reminded_on is null)
         or (x.due_on > x.today and x.due_on - x.today <= 2 and x.due_soon_reminded_on is null)
      order by x.due_on, x.id
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
    loop
      step := case when r.due_on < r.today then 'overdue'
                   when r.due_on = r.today then 'due_today' else 'due_soon' end;
      update aarogyam.lab_orders o
        set overdue_flagged_on = case when step = 'overdue' then r.today else o.overdue_flagged_on end,
            due_today_reminded_on = case when step = 'due_today' then r.today else o.due_today_reminded_on end,
            due_soon_reminded_on = case when step = 'due_soon' then r.today else o.due_soon_reminded_on end
      where o.org_id = r.org_id and o.id = r.id and o.due_on = r.due_on
        and o.status in ('sent', 'in_progress')
        and case step when 'overdue' then o.overdue_flagged_on is null
                      when 'due_today' then o.due_today_reminded_on is null
                      else o.due_soon_reminded_on is null end;
      continue when not found;
      org_id := r.org_id;
      lab_order_id := r.id;
      message_id := null;
      v_email := null;
      if step <> 'overdue' then
        select e.email into v_email from app.lab_reminder_email(r.org_id, r.id) e;
      end if;
      if v_email is not null then
        insert into aarogyam.outbox_events (org_id, event_key, channel, recipient, payload)
        values (r.org_id, 'lab_order.reminder', 'email', v_email,
                app.lab_reminder_payload(r.org_id, r.id, step))
        returning id into message_id;
      end if;
      insert into aarogyam.lab_order_events (org_id, lab_order_id, kind, due_on, reminder)
      values (r.org_id, r.id,
              case when step = 'overdue' then 'overdue'
                   when message_id is null then 'reminder_skipped' else 'reminded' end,
              r.due_on, case when step = 'overdue' then null else step end);
      return next;
    end loop;
  end
  $$;

revoke execute on function app.clinic_local_date(timestamptz, text) from public;
grant execute on function app.lab_reminder_payload(uuid, uuid, text) to app_user;
grant execute on function app.lab_reminder_email(uuid, uuid) to app_user;
grant execute on function app.run_lab_reminders(timestamptz, int) to aarogyam_api;
