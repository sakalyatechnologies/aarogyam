-- Live updates: small change signals for the SSE stream (GET /api/v1/events).
-- Each row change writes one row to private.live_events and sends a NOTIFY on the channel
-- `aarogyam_live` at commit. The payload holds identifiers and the kind only (clinic, branch,
-- record id, event id): never a name, a number or any clinical detail. The API listens on one
-- connection and fans the signals out to the subscribers of the same clinic.
--
-- Replay (Last-Event-ID): the table is a bounded buffer, the newest 2000 events of all clinics
-- (each insert trims older rows). Its id is the event id the stream sends as `id:`. A client that
-- reconnects with Last-Event-ID gets what it missed from the buffer, or a `reset` event when the
-- buffer no longer reaches back that far. The ids come from a sequence, so two transactions that
-- commit out of order can hand out ids out of order; a reconnect in that instant can miss one
-- signal (clients also refetch on a timer, so it heals).
-- The table is in `private`: no application role reads or writes it. The trigger function and the
-- two readers below run as their owner and filter to the caller's clinic themselves.
set local lock_timeout = '5s';

create table private.live_events (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  branch_id uuid,
  kind text not null,
  record_id uuid not null
);
create index live_events_org on private.live_events (org_id, id);
alter table private.live_events enable row level security;

create function app.live_signal() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  declare
    branch uuid;
    event bigint;
  begin
    if tg_argv[0] = 'notification.created' then
      select t.branch_id into branch from aarogyam.queue_tokens t
      where t.org_id = new.org_id and t.id = new.queue_token_id;
      if branch is null and new.appointment_id is not null then
        select a.branch_id into branch from aarogyam.appointments a
        where a.org_id = new.org_id and a.id = new.appointment_id;
      end if;
    else
      branch := new.branch_id;
    end if;
    insert into private.live_events (org_id, branch_id, kind, record_id)
    values (new.org_id, branch, tg_argv[0], new.id) returning id into event;
    delete from private.live_events where id < event - 2000;
    perform pg_notify('aarogyam_live', jsonb_build_object(
      'e', event, 'o', new.org_id, 'b', branch, 'k', tg_argv[0], 'i', new.id)::text);
    return null;
  end
  $$;
revoke all on function app.live_signal() from public;

create trigger live_queue_changed
  after insert or update of status, practitioner_id, room_id on aarogyam.queue_tokens
  for each row execute function app.live_signal('queue.changed');

create trigger live_visit_changed
  after insert or update of status, ended_at on aarogyam.encounters
  for each row execute function app.live_signal('visit.changed');

create trigger live_notification_created
  after insert on aarogyam.staff_notifications
  for each row execute function app.live_signal('notification.created');

-- The caller's clinic's events after p_after, oldest first, at most p_limit.
create function app.live_events_since(p_after bigint, p_limit int)
  returns table (id bigint, branch_id uuid, kind text, record_id uuid)
  language sql stable security definer set search_path = ''
  as $$
    select e.id, e.branch_id, e.kind, e.record_id
    from private.live_events e
    where e.org_id = (select app.tenant_id()) and e.id > p_after
    order by e.id
    limit p_limit
  $$;
revoke all on function app.live_events_since(bigint, int) from public;
grant execute on function app.live_events_since(bigint, int) to app_user;

-- The oldest and newest event ids held (null when empty), to tell whether a replay is complete.
create function app.live_events_bounds()
  returns table (lo bigint, hi bigint)
  language sql stable security definer set search_path = ''
  as $$
    select min(e.id), max(e.id) from private.live_events e
  $$;
revoke all on function app.live_events_bounds() from public;
grant execute on function app.live_events_bounds() to app_user;
