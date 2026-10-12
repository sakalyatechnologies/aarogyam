-- Staff to-dos: reminders, escalation and the missed sweep (docs/decisions.md, "Staff operations").
-- app.run_task_reminders(p_now, p_limit) is the drain job's step, one call for all clinics:
--   1. Missed sweep: an open occurrence becomes `missed` once the next occurrence of its task is
--      due, or 25 hours after it fell due, whichever is first; its notices are marked handled.
--   2. Reminders: reminder k+1 goes at due_at + (k+1) x interval, where the interval is the task's
--      remind_every_minutes, else org_settings.staff_ops.tasks.remind_every_minutes, else 60.
--      Reminders go on every interval, also after escalation, until the task is done or missed. A
--      reminder is taken with a conditional update (where reminder_count = k) and its
--      `task_reminder` notice (step_no k+1) is written only from the row that update returned, so
--      overlapping runs send once. A reminder skipped (quiet hours) leaves the count alone and goes
--      at the next run outside them; the last_reminded_at guard stops a catch-up becoming a burst.
--   3. Escalation: once reminder_count reaches the task's escalate_after (0 = never), one
--      `task_escalated` notice is written, for the owner role to see (the feed decides who reads
--      it, like every notice). Nothing is escalated when the task belongs to the owner.
-- Quiet hours are the clinic's own (org_settings.notifications.quiet_hours, 21:00 to 09:00
-- unless set or switched off), the same ones patient messages wait out; they hold reminders and
-- escalation, not the missed sweep. Tasks whose assignee cannot act any more, and clinics not in
-- use, get no reminders. Notices carry ids and numbers only.
set local lock_timeout = '5s';

create function app.run_task_reminders(p_now timestamptz, p_limit int)
  returns table (reminded int, escalated int, missed int)
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_limit int := least(greatest(coalesce(p_limit, 500), 1), 2000);
  begin
    -- 1. Missed sweep.
    with candidates as (
      select o.org_id, o.id
      from aarogyam.task_occurrences o
      join aarogyam.task_templates t on t.org_id = o.org_id and t.id = o.template_id
      join aarogyam.organizations g on g.id = o.org_id
      where o.status = 'open' and o.due_at < p_now
        and (p_now >= o.due_at + interval '25 hours'
             or exists (select 1 from aarogyam.task_occurrences later
                        where later.org_id = o.org_id and later.template_id = o.template_id
                          and later.due_at > o.due_at and later.due_at <= p_now)
             or exists (select 1
                        from app.task_due_dates(
                          t.schedule_kind, t.interval_days, t.weekdays, t.starts_on, t.ends_on,
                          t.due_time, t.once_at, g.timezone, o.due_at, p_now) nxt))
      order by o.due_at
      limit v_limit
    ),
    marked as (
      update aarogyam.task_occurrences o set status = 'missed'
      from candidates c
      where o.org_id = c.org_id and o.id = c.id and o.status = 'open'
      returning o.org_id, o.id
    ),
    handled as (
      update aarogyam.staff_notifications n set handled_at = p_now
      from marked m
      where n.org_id = m.org_id and n.task_occurrence_id = m.id and n.handled_at is null
      returning 1
    )
    select count(*)::int into missed from marked;

    -- 2. Reminders.
    with due as (
      select o.org_id, o.id, o.reminder_count as k
      from aarogyam.task_occurrences o
      join aarogyam.task_templates t on t.org_id = o.org_id and t.id = o.template_id
      join aarogyam.organizations g on g.id = o.org_id and g.status in ('trial', 'active')
      left join aarogyam.org_settings s on s.org_id = o.org_id
      cross join lateral (
        select least(greatest(coalesce(
          t.remind_every_minutes,
          case when s.staff_ops #>> '{tasks,remind_every_minutes}' ~ '^[0-9]{1,5}$'
               then (s.staff_ops #>> '{tasks,remind_every_minutes}')::int end,
          60), 15), 1440) as mins) iv
      where o.status = 'open'
        and p_now >= o.due_at + (o.reminder_count + 1) * iv.mins * interval '1 minute'
        and p_now < o.due_at + interval '25 hours'
        and (o.last_reminded_at is null
             or p_now >= o.last_reminded_at + iv.mins * interval '30 seconds')
        and app.message_quiet_until(p_now, g.timezone, coalesce(s.notifications, '{}')) is null
        and exists (select 1 from aarogyam.memberships m
                    where m.org_id = o.org_id and m.status = 'active'
                      and (m.id = o.assignee_membership_id or m.role_id = o.assignee_role_id))
      order by o.due_at
      limit v_limit
    ),
    taken as (
      update aarogyam.task_occurrences o
      set reminder_count = d.k + 1, last_reminded_at = p_now
      from due d
      where o.org_id = d.org_id and o.id = d.id and o.reminder_count = d.k and o.status = 'open'
      returning o.org_id, o.id, o.reminder_count
    ),
    notices as (
      insert into aarogyam.staff_notifications (org_id, kind, task_occurrence_id, step_no, href)
      select org_id, 'task_reminder', id, reminder_count, '/today' from taken
      on conflict do nothing
      returning 1
    )
    select count(*)::int into reminded from taken;

    -- 3. Escalation.
    with candidates as (
      select o.org_id, o.id
      from aarogyam.task_occurrences o
      join aarogyam.task_templates t on t.org_id = o.org_id and t.id = o.template_id
      join aarogyam.organizations g on g.id = o.org_id and g.status in ('trial', 'active')
      left join aarogyam.org_settings s on s.org_id = o.org_id
      where o.status = 'open' and o.escalated_at is null
        and t.escalate_after > 0 and o.reminder_count >= t.escalate_after
        and app.message_quiet_until(p_now, g.timezone, coalesce(s.notifications, '{}')) is null
        and not exists (select 1
                        from aarogyam.roles r
                        left join aarogyam.memberships am
                          on am.org_id = o.org_id and am.id = o.assignee_membership_id
                        where r.org_id = o.org_id and r.key = 'owner'
                          and (r.id = o.assignee_role_id or r.id = am.role_id))
      order by o.due_at
      limit v_limit
    ),
    taken as (
      update aarogyam.task_occurrences o set escalated_at = p_now
      from candidates c
      where o.org_id = c.org_id and o.id = c.id and o.status = 'open' and o.escalated_at is null
      returning o.org_id, o.id, o.reminder_count
    ),
    notices as (
      -- Takes the step of the last reminder; created_at orders the two.
      insert into aarogyam.staff_notifications (org_id, kind, task_occurrence_id, step_no, href)
      select org_id, 'task_escalated', id, reminder_count, '/today' from taken
      on conflict do nothing
      returning 1
    )
    select count(*)::int into escalated from taken;

    return next;
  end
  $$;
revoke execute on function app.run_task_reminders(timestamptz, int) from public;
grant execute on function app.run_task_reminders(timestamptz, int) to aarogyam_api;
