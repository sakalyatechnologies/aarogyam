-- A person's own sign-in sessions: where they are signed in, and signing one out.
--
-- These run before any clinic is known, for a person identified only by the Supabase Auth id
-- in their verified token, so they are lookup functions like app.my_clinics: SECURITY DEFINER,
-- filtering by that id themselves, returning only the person's own rows, executable only by
-- the API's login. A user-scoped transaction would need the user id first (another lookup)
-- and an update grant on sessions for app_user, which would then cover every column.
set local lock_timeout = '5s';

-- The person's sessions that are neither revoked nor expired, most recently used first.
-- `is_current` marks the session of the token asking.
create function app.my_sessions(p_auth_uid uuid, p_current_session uuid)
  returns table (id uuid, audience text, created_at timestamptz, last_active_at timestamptz,
                 expires_at timestamptz, is_current boolean)
  language sql stable security definer set search_path = ''
  as $$
    select s.id, s.audience, s.created_at, s.last_active_at, s.expires_at,
           s.provider_session_id = p_current_session
    from aarogyam.users u
    join aarogyam.sessions s on s.user_id = u.id
    where u.auth_uid = p_auth_uid and s.revoked_at is null and s.expires_at > now()
    order by s.last_active_at desc, s.id
    limit 50
  $$;

-- Revokes one of the person's own sessions and returns its provider session id, so the API
-- can drop anything it cached for it; no row when the session isn't theirs. Revoking twice
-- keeps the first time and reason. The change history records the person as the actor.
create function app.revoke_my_session(p_auth_uid uuid, p_session_id uuid)
  returns table (provider_session_id uuid)
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
    return query
      update aarogyam.sessions s
        set revoked_at = coalesce(s.revoked_at, now()),
            revoke_reason = coalesce(s.revoke_reason, 'signed_out')
        where s.id = p_session_id and s.user_id = v_user_id
        returning s.provider_session_id;
  end
  $$;

-- Whether a token's session may no longer be used: revoked, or recorded for someone else.
-- Routes that need no clinic (/me, invitations, the console) check this; clinic routes get
-- the same answer from app.authorize.
create function app.session_revoked(p_auth_uid uuid, p_session_id uuid)
  returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1
      from aarogyam.sessions s
      join aarogyam.users u on u.id = s.user_id
      where s.provider_session_id = p_session_id
        and (s.revoked_at is not null or u.auth_uid <> p_auth_uid))
  $$;

grant execute on function app.my_sessions(uuid, uuid) to aarogyam_api;
grant execute on function app.revoke_my_session(uuid, uuid) to aarogyam_api;
grant execute on function app.session_revoked(uuid, uuid) to aarogyam_api;
