-- Staff push notifications: the phone app registers its device, and the notification job pushes
-- every new staff notification to the devices of the members who would see it in their feed.
--
-- `aarogyam.devices` gains the app's own installation id (unique per user: the app asks to
-- register or remove "this install"), which app it is (the staff app now; the patient app is
-- reserved), the device's language, and the sign-in session that registered it. Existing rows
-- stay valid: every new column is null for them, and none is ever pushed to (no app).
--
-- Row-level security and grants are unchanged (0006): app_user sees only its own devices, and
-- nothing here is granted to it beyond that. Devices are written through the functions below,
-- which the API's login runs for the signed-in person before any clinic is known, like
-- app.my_sessions (0016). The table comment (`sensitivity=personal`) stands: a push token is
-- masked in the change history (0006) and never logged.
--
-- A device is pushed to only while the session that registered it is alive: not revoked (any
-- path: sign out, sign out everywhere, support) and used within 14 days (app.authorize keeps
-- last_active_at current), so a phone whose sign-out never reached the server falls silent.
-- Sign-out also clears the token (DELETE /me/devices/{installation_id}, or
-- POST /me/sessions/revoke-current, which also revokes the session).
set local lock_timeout = '5s';

alter table aarogyam.devices
  add column installation_id uuid,
  add column app text check (app in ('staff', 'patient')),
  add column locale text check (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  add column session_id uuid references aarogyam.sessions (id),
  add constraint devices_user_installation unique (user_id, installation_id),
  add constraint devices_push_token_length
    check (push_token is null or char_length(push_token) between 1 and 4096) not valid;
alter table aarogyam.devices validate constraint devices_push_token_length;
-- One phone holds a token: registering it for someone else moves it.
create unique index devices_push_token on aarogyam.devices (push_token)
  where push_token is not null;
create index devices_session on aarogyam.devices (session_id) where session_id is not null;

-- The job's marker: set when the notification was pushed, or deliberately not (too old).
alter table aarogyam.staff_notifications add column pushed_at timestamptz;
-- The job's queue across clinics, newest first.
create index staff_notifications_unpushed on aarogyam.staff_notifications (created_at)
  where pushed_at is null;
-- Marking a row pushed is not a change worth a history row.
update audit.audit_config set exclude = array_append(exclude, 'pushed_at')
  where table_name = 'aarogyam.staff_notifications';

-- Registers or refreshes the installation's device for the person with p_auth_uid, and records
-- the session that did it (made now when this is the first request the session has made).
-- A token held by another user or installation is taken from it: the phone changed hands.
-- False when the person has no active user record.
create function app.register_device(
  p_auth_uid uuid, p_provider_session uuid, p_session_expires timestamptz,
  p_installation_id uuid, p_platform text, p_token text, p_app text, p_locale text,
  p_app_version text)
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_user_id uuid;
    v_session_id uuid;
  begin
    select u.id into v_user_id from aarogyam.users u
      where u.auth_uid = p_auth_uid and u.status = 'active';
    if v_user_id is null then
      return false;
    end if;
    perform set_config('app.user_id', v_user_id::text, true);
    if p_provider_session is not null then
      insert into aarogyam.sessions (user_id, provider_session_id, audience, expires_at)
        values (v_user_id, p_provider_session, 'clinic', coalesce(p_session_expires, now() + interval '1 hour'))
        on conflict (provider_session_id) do update set last_active_at = now()
          where aarogyam.sessions.last_active_at < now() - interval '5 minutes'
            and aarogyam.sessions.user_id = v_user_id;
      select s.id into v_session_id from aarogyam.sessions s
        where s.provider_session_id = p_provider_session and s.user_id = v_user_id;
    end if;
    update aarogyam.devices d set push_token = null, push_token_updated_at = now()
      where d.push_token = p_token
        and (d.user_id <> v_user_id or d.installation_id is distinct from p_installation_id);
    insert into aarogyam.devices (user_id, installation_id, platform, push_token,
                                  push_token_updated_at, app, locale, app_version, session_id)
      values (v_user_id, p_installation_id, p_platform, p_token, now(), p_app, p_locale,
              p_app_version, v_session_id)
      on conflict (user_id, installation_id) do update
        set platform = excluded.platform, push_token = excluded.push_token,
            push_token_updated_at = excluded.push_token_updated_at, app = excluded.app,
            locale = excluded.locale, app_version = excluded.app_version,
            session_id = excluded.session_id;
    return true;
  end
  $$;

-- Clears the push token of the person's own installation (sign-out). Nothing happens when the
-- installation is not theirs or unknown, so removing twice is fine.
create function app.unregister_device(p_auth_uid uuid, p_installation_id uuid)
  returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_user_id uuid;
  begin
    select u.id into v_user_id from aarogyam.users u where u.auth_uid = p_auth_uid;
    if v_user_id is null then
      return;
    end if;
    perform set_config('app.user_id', v_user_id::text, true);
    update aarogyam.devices d
      set push_token = null, push_token_updated_at = now(), session_id = null
      where d.user_id = v_user_id and d.installation_id = p_installation_id
        and d.push_token is not null;
  end
  $$;

-- Signs out the caller's own session (the one whose token asks): revokes it, recording it first
-- when this is the first request it made, and clears the push tokens of the devices it
-- registered. False when the person has no user record.
create function app.revoke_current_session(p_auth_uid uuid, p_provider_session uuid,
                                           p_session_expires timestamptz)
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_user_id uuid;
    v_session_id uuid;
  begin
    select u.id into v_user_id from aarogyam.users u where u.auth_uid = p_auth_uid;
    if v_user_id is null then
      return false;
    end if;
    perform set_config('app.user_id', v_user_id::text, true);
    insert into aarogyam.sessions (user_id, provider_session_id, audience, expires_at,
                                   revoked_at, revoke_reason)
      values (v_user_id, p_provider_session, 'clinic',
              coalesce(p_session_expires, now() + interval '1 hour'), now(), 'signed_out')
      on conflict (provider_session_id) do update
        set revoked_at = coalesce(aarogyam.sessions.revoked_at, now()),
            revoke_reason = coalesce(aarogyam.sessions.revoke_reason, 'signed_out')
        where aarogyam.sessions.user_id = v_user_id
      returning id into v_session_id;
    if v_session_id is not null then
      update aarogyam.devices d set push_token = null, push_token_updated_at = now()
        where d.session_id = v_session_id and d.push_token is not null;
    end if;
    return v_session_id is not null;
  end
  $$;

-- The push job's claim across clinics: staff notifications not pushed yet, newest first, marked
-- pushed at p_now in the same statement (best effort: a crash after this loses the push, never
-- sends it twice). `fresh` is false for rows whose creation or last remind (a doctor's Remind
-- clears pushed_at, so the row is pushed again) is older than 30 minutes, which are marked without
-- being sent, so a newly enabled sender doesn't blast a backlog.
create function app.claim_staff_push(p_now timestamptz, p_limit int)
  returns table (org_id uuid, id uuid, kind text, href text, fresh boolean)
  language sql volatile security definer set search_path = ''
  as $$
    with due as (
      select n.org_id, n.id from aarogyam.staff_notifications n
      where n.pushed_at is null
      order by n.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
      for update skip locked
    ),
    marked as (
      update aarogyam.staff_notifications n set pushed_at = p_now
      from due where n.org_id = due.org_id and n.id = due.id
      returning n.org_id, n.id, n.kind, n.href, n.created_at, n.reminded_at
    )
    select m.org_id, m.id, m.kind, m.href,
           greatest(m.created_at, coalesce(m.reminded_at, m.created_at)) > p_now - interval '30 minutes'
    from marked m
    order by m.created_at
  $$;

-- The active members of a clinic with their role's permissions, in the shape app.authorize
-- gives, so the job can work out who sees a notification with the feed's own rules.
create function app.push_members(p_org_id uuid)
  returns table (user_id uuid, user_status text, membership_id uuid, membership_status text,
                 role_key text, permissions text[], scopes text[])
  language sql stable security definer set search_path = ''
  as $$
    select u.id, u.status, m.id, m.status, r.key,
           coalesce(array_agg(rp.permission order by rp.permission) filter (where rp.permission is not null), '{}'),
           coalesce(array_agg(rp.scope order by rp.permission) filter (where rp.permission is not null), '{}')
    from aarogyam.memberships m
    join aarogyam.users u on u.id = m.user_id
    join aarogyam.organizations o on o.id = m.org_id
    join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
    left join aarogyam.role_permissions rp on rp.org_id = m.org_id and rp.role_id = m.role_id
    -- Open clinics only (ClinicStatus::is_open): the feed refuses the others too.
    where m.org_id = p_org_id and m.status = 'active' and u.status = 'active'
      and o.status in ('trial', 'active')
    group by u.id, u.status, m.id, m.status, r.key
  $$;

-- The staff-app devices of these users that can be pushed to: with a token, registered by a
-- session that is not revoked and was used in the last 14 days.
create function app.push_devices(p_user_ids uuid[])
  returns table (id uuid, user_id uuid, platform text, push_token text)
  language sql stable security definer set search_path = ''
  as $$
    select d.id, d.user_id, d.platform, d.push_token
    from aarogyam.devices d
    join aarogyam.sessions s on s.id = d.session_id
    where d.user_id = any (p_user_ids) and d.app = 'staff' and d.push_token is not null
      and s.revoked_at is null and s.last_active_at > now() - interval '14 days'
  $$;

-- Forgets a token the provider reported dead, unless the device registered a new one meanwhile.
create function app.clear_device_token(p_device_id uuid, p_token text)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.devices d set push_token = null, push_token_updated_at = now()
    where d.id = p_device_id and d.push_token = p_token
  $$;

revoke execute on function app.register_device(uuid, uuid, timestamptz, uuid, text, text, text, text, text) from public;
revoke execute on function app.unregister_device(uuid, uuid) from public;
revoke execute on function app.revoke_current_session(uuid, uuid, timestamptz) from public;
revoke execute on function app.claim_staff_push(timestamptz, int) from public;
revoke execute on function app.push_members(uuid) from public;
revoke execute on function app.push_devices(uuid[]) from public;
revoke execute on function app.clear_device_token(uuid, text) from public;
grant execute on function app.register_device(uuid, uuid, timestamptz, uuid, text, text, text, text, text) to aarogyam_api;
grant execute on function app.unregister_device(uuid, uuid) to aarogyam_api;
grant execute on function app.revoke_current_session(uuid, uuid, timestamptz) to aarogyam_api;
grant execute on function app.claim_staff_push(timestamptz, int) to aarogyam_api;
grant execute on function app.push_members(uuid) to aarogyam_api;
grant execute on function app.push_devices(uuid[]) to aarogyam_api;
grant execute on function app.clear_device_token(uuid, text) to aarogyam_api;
