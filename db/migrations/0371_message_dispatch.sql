-- The patient message worker's functions (see 0370). It acts for no one clinic, so it claims,
-- reads and settles messages through these definer functions on the API's own connection and
-- never reads patients directly.
set local lock_timeout = '5s';

-- When the clinic's quiet hours end, if p_at falls inside them; null otherwise. Quiet hours are
-- org_settings.notifications->'quiet_hours' {"start": "21:00", "end": "09:00"} in the clinic's
-- time zone, 21:00 to 09:00 when unset or unreadable. Reminders and promotional messages that
-- fall inside wait until the end instead of failing.
create function app.message_quiet_until(p_at timestamptz, p_timezone text, p_notifications jsonb)
  returns timestamptz
  language plpgsql stable set search_path = ''
  as $$
  declare
    v_zone text := coalesce(nullif(p_timezone, ''), 'Asia/Kolkata');
    v_start time;
    v_end time;
    v_local timestamp;
    v_quiet boolean;
  begin
    begin
      v_start := coalesce((p_notifications->'quiet_hours'->>'start')::time, time '21:00');
      v_end := coalesce((p_notifications->'quiet_hours'->>'end')::time, time '09:00');
    exception when others then
      v_start := time '21:00';
      v_end := time '09:00';
    end;
    begin
      v_local := p_at at time zone v_zone;
    exception when invalid_parameter_value then
      v_zone := 'Asia/Kolkata';
      v_local := p_at at time zone v_zone;
    end;
    v_quiet := case
      when v_start = v_end then false
      when v_start > v_end then v_local::time >= v_start or v_local::time < v_end
      else v_local::time >= v_start and v_local::time < v_end
    end;
    if not v_quiet then
      return null;
    end if;
    -- The next time the clock reads v_end: today if it is still before, else tomorrow.
    return ((v_local::date + (v_local::time >= v_end)::int) + v_end) at time zone v_zone;
  end
  $$;
revoke execute on function app.message_quiet_until(timestamptz, text, jsonb) from public;

-- Claims up to p_limit due messages on p_channel across clinics for p_lease_seconds, within a
-- platform-wide daily budget per provider (UTC days, as providers count them): messages sent
-- today plus those being sent count against p_daily_budget. Due messages beyond the budget are
-- moved to the start of the next day and returned with `deferred` true; claimed ones with false.
-- Workers take turns (an advisory lock per provider), so two can't both spend the last of it.
create function app.messages_claim(p_channel text, p_provider text, p_daily_budget int,
                                   p_limit int, p_lease_seconds int)
  returns table (org_id uuid, id uuid, attempts int, deferred boolean)
  language plpgsql volatile security definer set search_path = ''
  as $$
  #variable_conflict use_column
  declare
    v_today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
    v_room int;
  begin
    perform pg_advisory_xact_lock(hashtext('app.messages_claim'), hashtext(p_provider));
    select greatest(coalesce(p_daily_budget, 100) - count(*), 0) into v_room
    from aarogyam.messages m
    where m.provider = p_provider
      and (m.sent_at >= v_today or (m.status = 'sending' and m.lease_until > now()));
    return query
    with locked as (
      select m.org_id, m.id, m.scheduled_for
      from aarogyam.messages m
      where m.channel = p_channel
        and ((m.status = 'queued' and m.scheduled_for <= now())
             or (m.status = 'sending' and m.lease_until <= now()))
      order by m.scheduled_for, m.id
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked
    ),
    due as (
      select l.org_id, l.id, row_number() over (order by l.scheduled_for, l.id) as n from locked l
    ),
    claimed as (
      update aarogyam.messages m
        set status = 'sending', attempts = m.attempts + 1, provider = p_provider,
            lease_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 60), 1))
      from due
      where m.org_id = due.org_id and m.id = due.id and due.n <= v_room
      returning m.org_id, m.id, m.attempts, false
    ),
    put_off as (
      update aarogyam.messages m
        set status = 'queued', lease_until = null, provider = null,
            scheduled_for = v_today + interval '1 day'
      from due
      where m.org_id = due.org_id and m.id = due.id and due.n > v_room
      returning m.org_id, m.id, m.attempts, true
    )
    select * from claimed union all select * from put_off;
  end
  $$;
revoke execute on function app.messages_claim(text, text, int, int, int) from public;
grant execute on function app.messages_claim(text, text, int, int, int) to aarogyam_api;

-- Everything the worker needs to decide and render one message, in one query, at send time:
-- the message, the patient's address on its channel, whether consent allows its purpose now
-- (app.may_contact), whether the patient opted out of the channel for it, the patient's state,
-- the end of the clinic's quiet hours if they are on, the clinic's name and portal host, and the
-- appointment a reminder is about. No row when the message doesn't exist in that clinic.
create function app.message_dispatch(p_org_id uuid, p_message_id uuid)
  returns table (status text, channel text, kind text, purpose text, template_key text,
                 variables jsonb, body text, secret text, address text, may_contact boolean,
                 opted_out boolean, patient_state text, quiet_until timestamptz,
                 clinic_name text, timezone text, portal_host text, appointment_status text,
                 appointment_starts_at timestamptz, doctor_name text)
  language sql stable security definer set search_path = ''
  as $$
    select m.status, m.channel, m.kind, m.purpose, m.template_key, m.variables, m.body, m.secret,
           case m.channel when 'email' then p.email else p.phone_e164 end,
           app.may_contact(m.org_id, m.patient_id, m.purpose),
           exists (select 1 from aarogyam.contact_preferences c
                   where c.org_id = m.org_id and c.patient_id = m.patient_id
                     and c.channel = m.channel and c.category in ('all', m.purpose) and c.opted_out),
           case when p.status = 'erased' then 'erased'
                when p.status = 'merged' then 'merged'
                when p.deleted_at is not null then 'deleted'
                when p.status = 'deceased' then 'deceased'
                else 'active' end,
           app.message_quiet_until(now(), o.timezone, coalesce(s.notifications, '{}')),
           o.name, o.timezone,
           (select d.hostname from aarogyam.org_domains d
            where d.org_id = m.org_id and d.kind = 'portal' and d.is_primary
              and d.verified_at is not null limit 1),
           a.status, a.starts_at, pr.display_name
    from aarogyam.messages m
    join aarogyam.patients p on p.org_id = m.org_id and p.id = m.patient_id
    join aarogyam.organizations o on o.id = m.org_id
    left join aarogyam.org_settings s on s.org_id = m.org_id
    left join aarogyam.appointments a on a.org_id = m.org_id and a.id = m.appointment_id
    left join aarogyam.practitioners pr on pr.org_id = a.org_id and pr.id = a.practitioner_id
    where m.org_id = p_org_id and m.id = p_message_id
  $$;
revoke execute on function app.message_dispatch(uuid, uuid) from public;
grant execute on function app.message_dispatch(uuid, uuid) to aarogyam_api;

-- Settling a claimed message. Each acts only on a message still `sending`, so a worker whose
-- lease lapsed can't overwrite what another worker recorded.

-- Stores the hash of the unsubscribe token the email is about to carry.
create function app.message_unsubscribe_hash(p_org_id uuid, p_id uuid, p_hash text)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.messages set unsubscribe_hash = p_hash
    where org_id = p_org_id and id = p_id and status = 'sending'
  $$;

-- Sent: the secret goes; the provider's id stays for webhooks.
create function app.message_sent(p_org_id uuid, p_id uuid, p_provider text,
                                 p_provider_message_id text, p_cost_paise bigint)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.messages
      set status = 'sent', sent_at = now(), processed_at = now(), lease_until = null,
          secret = null, last_error = null, provider = p_provider,
          provider_message_id = p_provider_message_id, cost_paise = p_cost_paise
      where org_id = p_org_id and id = p_id and status = 'sending'
  $$;

-- Not sent, and never will be, for p_reason (consent, an opt-out, no address...).
create function app.message_skipped(p_org_id uuid, p_id uuid, p_reason text)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.messages
      set status = 'skipped', skip_reason = p_reason, processed_at = now(), lease_until = null,
          secret = null, provider = null
      where org_id = p_org_id and id = p_id and status = 'sending'
  $$;

-- Waits until p_at (quiet hours, or a reminder whose appointment moved later). Not an attempt.
create function app.message_rescheduled(p_org_id uuid, p_id uuid, p_at timestamptz)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.messages
      set status = 'queued', scheduled_for = p_at, lease_until = null, provider = null,
          attempts = greatest(attempts - 1, 0)
      where org_id = p_org_id and id = p_id and status = 'sending'
  $$;

-- A failed attempt: tried again at p_retry_at, or abandoned when it is null.
create function app.message_failed(p_org_id uuid, p_id uuid, p_error text, p_retry_at timestamptz)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.messages
      set last_error = left(p_error, 200), lease_until = null,
          status = case when p_retry_at is null then 'failed' else 'queued' end,
          scheduled_for = coalesce(p_retry_at, scheduled_for),
          processed_at = case when p_retry_at is null then now() end,
          secret = case when p_retry_at is null then null else secret end
      where org_id = p_org_id and id = p_id and status = 'sending'
  $$;

revoke execute on function app.message_unsubscribe_hash(uuid, uuid, text) from public;
revoke execute on function app.message_sent(uuid, uuid, text, text, bigint) from public;
revoke execute on function app.message_skipped(uuid, uuid, text) from public;
revoke execute on function app.message_rescheduled(uuid, uuid, timestamptz) from public;
revoke execute on function app.message_failed(uuid, uuid, text, timestamptz) from public;
grant execute on function app.message_unsubscribe_hash(uuid, uuid, text) to aarogyam_api;
grant execute on function app.message_sent(uuid, uuid, text, text, bigint) to aarogyam_api;
grant execute on function app.message_skipped(uuid, uuid, text) to aarogyam_api;
grant execute on function app.message_rescheduled(uuid, uuid, timestamptz) to aarogyam_api;
grant execute on function app.message_failed(uuid, uuid, text, timestamptz) to aarogyam_api;
