-- Staff to-dos, time off and stock alerts: the shared foundation (docs/decisions.md, "Staff
-- operations"). Later migrations (0661 on) add the tables; this one holds what they share, so
-- they can be built side by side.
--   * Permissions: tasks.use (everyone), tasks.manage (owner, doctor), time_off.request
--     (everyone), time_off.manage (owner). Stock reuses inventory.read and inventory.manage.
--   * staff_notifications is about a task occurrence, a time-off request or a stock item as well:
--     new subject columns, the kinds task_due, task_reminder, task_escalated, time_off_requested,
--     time_off_decided and stock_alert, and a check per kind. Rows carry ids and numbers only,
--     never a name or a reason. The foreign keys come with each feature's own migration, once the
--     table they point at exists.
--   * org_settings.staff_ops: the clinic's choices for these features (time_off.requires_approval,
--     tasks.remind_every_minutes); the API fills defaults for any key that is missing.
-- Expand only: existing rows and readers are unchanged.
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description) values
  ('tasks.use', 'tasks', 'See and complete the clinic''s daily tasks assigned to you or your role'),
  ('tasks.manage', 'tasks', 'Create, edit and switch off the clinic''s recurring tasks; see their history'),
  ('time_off.request', 'time_off', 'Ask for time off and see who is away'),
  ('time_off.manage', 'time_off', 'Approve or decline time off, and record it for others');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, p.permission, 'all'
from (values
  ('owner', 'tasks.use'), ('owner', 'tasks.manage'),
  ('owner', 'time_off.request'), ('owner', 'time_off.manage'),
  ('doctor', 'tasks.use'), ('doctor', 'tasks.manage'), ('doctor', 'time_off.request'),
  ('consultant', 'tasks.use'), ('consultant', 'time_off.request'),
  ('front_desk', 'tasks.use'), ('front_desk', 'time_off.request'),
  ('assistant', 'tasks.use'), ('assistant', 'time_off.request'),
  ('finance', 'tasks.use'), ('finance', 'time_off.request')
) as p(template, permission)
join aarogyam.role_templates t on t.key = p.template;

-- Clinics that exist already got their standard roles from the templates; give those the same.
insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null
  and tp.permission in ('tasks.use', 'tasks.manage', 'time_off.request', 'time_off.manage')
on conflict do nothing;

alter table aarogyam.staff_notifications
  add column task_occurrence_id uuid,
  add column time_off_request_id uuid,
  add column inventory_item_id uuid,
  -- Reminders: 0 is the first notice, then one per reminder; the newest step is the one shown.
  add column step_no int check (step_no is null or step_no >= 0),
  -- A stock alert is about an item on a day, so it can fire again another day.
  add column alert_on date,
  add column stock_on_hand numeric(12, 3),
  add column stock_days_cover numeric(8, 1),
  add column stock_reason text check (stock_reason is null or stock_reason in ('low', 'projected')),
  drop constraint staff_notifications_kind_check,
  drop constraint staff_notifications_one_subject,
  add constraint staff_notifications_kind_check check (kind in
    ('booking_requested', 'booking_confirmed_auto', 'booking_cancelled_by_patient', 'lab_overdue',
     'arrival', 'payment_due', 'recall_due', 'patient_waiting', 'send_in', 'collect_payment',
     'task_due', 'task_reminder', 'task_escalated', 'time_off_requested', 'time_off_decided',
     'stock_alert'))
    not valid,
  add constraint staff_notifications_one_subject
    check (num_nonnulls(appointment_id, lab_order_id, invoice_id, recall_id, queue_token_id,
                        task_occurrence_id, time_off_request_id, inventory_item_id) = 1) not valid,
  add constraint staff_notifications_task_subject
    check ((kind in ('task_due', 'task_reminder', 'task_escalated')) = (task_occurrence_id is not null)
           and (task_occurrence_id is null) = (step_no is null)) not valid,
  add constraint staff_notifications_time_off_subject
    check ((kind in ('time_off_requested', 'time_off_decided')) = (time_off_request_id is not null))
    not valid,
  add constraint staff_notifications_stock_subject
    check ((kind = 'stock_alert') = (inventory_item_id is not null)
           and (inventory_item_id is null) = (alert_on is null)
           and (inventory_item_id is null) = (stock_reason is null)
           and (inventory_item_id is not null or (stock_on_hand is null and stock_days_cover is null)))
    not valid;
alter table aarogyam.staff_notifications validate constraint staff_notifications_kind_check;
alter table aarogyam.staff_notifications validate constraint staff_notifications_one_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_task_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_time_off_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_stock_subject;

-- One notice per task occurrence, kind and step; one per time-off request and kind (asked,
-- decided); one stock alert per item and day.
create unique index staff_notifications_task_step
  on aarogyam.staff_notifications (org_id, task_occurrence_id, kind, step_no)
  where task_occurrence_id is not null;
create unique index staff_notifications_time_off
  on aarogyam.staff_notifications (org_id, time_off_request_id, kind)
  where time_off_request_id is not null;
create unique index staff_notifications_stock_alert
  on aarogyam.staff_notifications (org_id, inventory_item_id, alert_on)
  where kind = 'stock_alert';

alter table aarogyam.org_settings
  add column staff_ops jsonb not null default '{}' check (jsonb_typeof(staff_ops) = 'object');
-- The settings screens' route checks settings.manage; the columns the clinic itself edits.
grant update (staff_ops) on aarogyam.org_settings to app_user;
