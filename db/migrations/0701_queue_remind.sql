-- "Remind the doctor": a waiting patient's token re-raises its patient_waiting notification.
--   * queue_tokens.last_reminded_at: when the desk or doctor last pressed remind; one press per
--     token per minute.
--   * staff_notification_reads: a re-raise must make the row unread again for everyone who read
--     it, so reads become deletable (by the remind path only; updates stay forbidden).
-- Expand only: a new nullable column; reads still can't be changed, only dropped.
set local lock_timeout = '5s';

alter table aarogyam.queue_tokens add column last_reminded_at timestamptz;

drop trigger forbid_change on aarogyam.staff_notification_reads;
create trigger forbid_update before update on aarogyam.staff_notification_reads
  for each row execute function app.forbid_change();
grant delete on aarogyam.staff_notification_reads to app_user;
comment on table aarogyam.staff_notification_reads is 'sensitivity=internal offline=server_only lifecycle=ephemeral';
