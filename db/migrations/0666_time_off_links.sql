-- Links the time-off table to what points at it, and guards the clinic's staff-operations
-- settings.
--   * staff_notifications.time_off_request_id (added by 0660 without a key) now has one.
--   * org_settings.staff_ops: time_off.requires_approval is a boolean and
--     tasks.remind_every_minutes a whole number from 15 to 1440 when present; the API fills
--     defaults for what is missing. Members may already update the column (0660 grants it, as
--     0015 does for the organisation's names); the API route checks settings.manage.
set local lock_timeout = '5s';

alter table aarogyam.staff_notifications
  add constraint staff_notifications_time_off_fk
  foreign key (org_id, time_off_request_id) references aarogyam.time_off_requests (org_id, id);

alter table aarogyam.org_settings
  add constraint org_settings_staff_ops_shape check (
    (not (staff_ops ? 'time_off') or (
      jsonb_typeof(staff_ops -> 'time_off') = 'object'
      and (not (staff_ops -> 'time_off' ? 'requires_approval')
           or jsonb_typeof(staff_ops -> 'time_off' -> 'requires_approval') = 'boolean')))
    and (not (staff_ops ? 'tasks') or (
      jsonb_typeof(staff_ops -> 'tasks') = 'object'
      and (not (staff_ops -> 'tasks' ? 'remind_every_minutes')
           or (jsonb_typeof(staff_ops -> 'tasks' -> 'remind_every_minutes') = 'number'
               and (staff_ops -> 'tasks' ->> 'remind_every_minutes') ~ '^[0-9]+$'
               and (staff_ops -> 'tasks' ->> 'remind_every_minutes')::int between 15 and 1440))))
  );
