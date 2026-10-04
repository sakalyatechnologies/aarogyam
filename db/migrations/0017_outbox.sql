-- The outbox: messages to send because of a change, written in the same transaction as the
-- change, so a message is never lost and never sent for a change that rolled back. A worker
-- (for now the local drain route; later Cloud Scheduler calling it with a Google-signed token)
-- claims due rows across clinics, delivers them, and records the outcome.
set local lock_timeout = '5s';

create table aarogyam.outbox_events (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  event_key text not null check (event_key ~ '^[a-z_]+\.[a-z_]+$'),
  channel text not null check (channel in ('email')),
  -- The address to deliver to, for messages to staff; patient messages will carry the patient's
  -- id in the payload instead and be addressed when sent.
  recipient text check (char_length(recipient) between 3 and 320),
  -- Ids and the few non-patient values a template needs (clinic name, role name); never
  -- patient details.
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  -- A one-time link secret the message carries (an invitation token). Cleared once the
  -- message is sent or abandoned, so it lives no longer than it must.
  secret text check (char_length(secret) <= 200),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 200),
  provider text check (provider in ('log', 'resend')),
  provider_message_id text check (char_length(provider_message_id) <= 200),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  check ((status = 'pending') = (processed_at is null)),
  check (status = 'pending' or secret is null)
);
-- The worker's queue: due rows across every clinic.
create index outbox_events_due on aarogyam.outbox_events (next_attempt_at) where status = 'pending';
create index outbox_events_processed on aarogyam.outbox_events (processed_at) where processed_at is not null;
comment on table aarogyam.outbox_events is 'sensitivity=personal offline=server_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.outbox_events', 'ephemeral');

-- The change history keeps who queued a message and its outcome, not each delivery attempt,
-- and never the address or the secret.
insert into audit.audit_config (table_name, exclude, mask) values
  ('aarogyam.outbox_events', '{attempts,next_attempt_at,last_error}', '{recipient,secret}');

-- Claims up to p_limit due messages across clinics for p_lease_seconds: each claimed row's
-- attempt count goes up and its next attempt moves past the lease, so a worker that dies
-- mid-delivery leaves the row to be retried, and concurrent workers skip each other's rows.
create function app.outbox_claim(p_limit int, p_lease_seconds int)
  returns table (org_id uuid, id uuid, event_key text, channel text, recipient text,
                 payload jsonb, secret text, attempts int)
  language sql volatile security definer set search_path = ''
  as $$
    with due as (
      select o.org_id, o.id
      from aarogyam.outbox_events o
      where o.status = 'pending' and o.next_attempt_at <= now()
      order by o.next_attempt_at
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked
    )
    update aarogyam.outbox_events o
      set attempts = o.attempts + 1,
          next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 60), 1))
      from due
      where o.org_id = due.org_id and o.id = due.id
      returning o.org_id, o.id, o.event_key, o.channel, o.recipient, o.payload, o.secret, o.attempts
  $$;

-- Records a delivery. The secret goes; the provider's message id stays for receipts.
create function app.outbox_sent(p_org_id uuid, p_id uuid, p_provider text, p_provider_message_id text)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.outbox_events
      set status = 'sent', processed_at = now(), secret = null, last_error = null,
          provider = p_provider, provider_message_id = p_provider_message_id
      where org_id = p_org_id and id = p_id and status = 'pending'
  $$;

-- Records a failed attempt: retried at p_retry_at, or abandoned when it is null.
create function app.outbox_failed(p_org_id uuid, p_id uuid, p_error text, p_retry_at timestamptz)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.outbox_events
      set last_error = left(p_error, 200),
          next_attempt_at = coalesce(p_retry_at, next_attempt_at),
          status = case when p_retry_at is null then 'failed' else 'pending' end,
          processed_at = case when p_retry_at is null then now() end,
          secret = case when p_retry_at is null then null else secret end
      where org_id = p_org_id and id = p_id and status = 'pending'
  $$;

-- Deletes messages processed more than p_keep_days ago; returns how many.
create function app.outbox_purge(p_keep_days int)
  returns bigint
  language sql volatile security definer set search_path = ''
  as $$
    with gone as (
      delete from aarogyam.outbox_events
      where processed_at < now() - make_interval(days => greatest(coalesce(p_keep_days, 30), 1))
      returning 1
    )
    select count(*) from gone
  $$;

grant execute on function app.outbox_claim(int, int) to aarogyam_api;
grant execute on function app.outbox_sent(uuid, uuid, text, text) to aarogyam_api;
grant execute on function app.outbox_failed(uuid, uuid, text, timestamptz) to aarogyam_api;
grant execute on function app.outbox_purge(int) to aarogyam_api;
