-- Who sees the staff-operations notifications (docs/decisions.md, "Staff operations"), written
-- once so the feed, the bell count, the badges and "mark read" agree.
--   * task_due, task_reminder: the task's assignee member, or members whose role is the assigned
--     role, with tasks.use. task_escalated: the owner role only.
--   * time_off_requested: holders of time_off.manage. time_off_decided: the requester only.
--   * stock_alert: everyone with inventory.read.
--   * A task shows only its newest step (the highest step_no; an escalation outranks the reminder
--     that took the same step). The newest step a viewer could see wins, so an assignee still
--     sees the last reminder after an escalation they are not told about.
-- The older kinds are not touched: both functions say false for them. Expand only.
set local lock_timeout = '5s';

create function app.staff_ops_notification_visible(
  n aarogyam.staff_notifications, p_member uuid, p_owner boolean, p_tasks boolean,
  p_inventory boolean, p_time_off boolean)
  returns boolean
  language sql stable
  as $$
    select case
      when n.kind = 'task_escalated' then p_tasks and p_owner
      when n.kind in ('task_due', 'task_reminder') then
        p_tasks and exists (
          select 1 from aarogyam.task_occurrences o
          where o.org_id = n.org_id and o.id = n.task_occurrence_id
            and (o.assignee_membership_id = p_member
                 or o.assignee_role_id = (select m.role_id from aarogyam.memberships m
                                          where m.org_id = n.org_id and m.id = p_member)))
      when n.kind = 'time_off_requested' then p_time_off
      when n.kind = 'time_off_decided' then
        exists (select 1 from aarogyam.time_off_requests t
                where t.org_id = n.org_id and t.id = n.time_off_request_id
                  and t.membership_id = p_member)
      when n.kind = 'stock_alert' then p_inventory
      else false
    end
  $$;
grant execute on function app.staff_ops_notification_visible(
  aarogyam.staff_notifications, uuid, boolean, boolean, boolean, boolean) to app_user;

-- False when a newer step of the same task is visible to the viewer; true for every other row.
create function app.staff_ops_notification_newest(
  n aarogyam.staff_notifications, p_member uuid, p_owner boolean, p_tasks boolean)
  returns boolean
  language sql stable
  as $$
    select n.task_occurrence_id is null or not exists (
      select 1 from aarogyam.staff_notifications later
      where later.org_id = n.org_id and later.task_occurrence_id = n.task_occurrence_id
        and (later.step_no > n.step_no
             or (later.step_no = n.step_no and later.kind = 'task_escalated'
                 and n.kind <> 'task_escalated'))
        and app.staff_ops_notification_visible(later, p_member, p_owner, p_tasks, false, false))
  $$;
grant execute on function app.staff_ops_notification_newest(
  aarogyam.staff_notifications, uuid, boolean, boolean) to app_user;
