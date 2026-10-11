-- BE3 live updates: small change signals for the SSE stream (GET /api/v1/events).
-- Each row change sends a NOTIFY on the channel `aarogyam_live` at commit. The payload holds
-- identifiers and the kind only (clinic, branch, record id): never a name, a number or any
-- clinical detail. The API listens on one connection and fans the signals out to the
-- subscribers of the same clinic. NOTIFY is not stored, so a client that was away refetches.
create function app.live_signal() returns trigger
  language plpgsql set search_path = ''
  as $$
  declare
    branch uuid;
  begin
    if tg_argv[0] = 'notification.created' then
      select t.branch_id into branch from aarogyam.queue_tokens t
      where t.org_id = new.org_id and t.id = new.queue_token_id;
    else
      branch := new.branch_id;
    end if;
    perform pg_notify('aarogyam_live', jsonb_build_object(
      'o', new.org_id, 'b', branch, 'k', tg_argv[0], 'i', new.id)::text);
    return null;
  end
  $$;

create trigger live_queue_changed
  after insert or update of status, practitioner_id, room_id on aarogyam.queue_tokens
  for each row execute function app.live_signal('queue.changed');

create trigger live_visit_changed
  after insert or update of status, ended_at on aarogyam.encounters
  for each row execute function app.live_signal('visit.changed');

create trigger live_notification_created
  after insert on aarogyam.staff_notifications
  for each row execute function app.live_signal('notification.created');
