-- Clinic sign-in sessions end (docs/decisions.md, "Sign-in sessions end"). Supabase keeps a
-- browser signed in for as long as its refresh token is used, so a computer that signed in once
-- stayed in for good. app.authorize now ends a browser session that has been idle for 12 hours
-- or was first seen more than 7 days ago. A phone app's session (one a registered device points
-- at, 0714) ends after 30 idle days, so phones stay signed in and keep getting pushes (which stop
-- after 14 idle days). An ended session is marked revoked (reason `idle` or `expired`), the API
-- answers 401, and the app signs out to its sign-in screen. Signing in again makes a new
-- Supabase session, which starts fresh. Same signature, so the API needs no change.
set local lock_timeout = '5s';

create or replace function app.authorize(p_org_id uuid, p_auth_uid uuid, p_session_id uuid, p_session_expires_at timestamptz)
  returns table (
    user_id uuid,
    user_status text,
    membership_id uuid,
    membership_status text,
    role_key text,
    permissions text[],
    scopes text[],
    session_revoked boolean
  )
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_user_id uuid;
    v_user_status text;
  begin
    select u.id, u.status into v_user_id, v_user_status
      from aarogyam.users u where u.auth_uid = p_auth_uid;
    if v_user_id is null then
      return;
    end if;

    -- Checked before this request counts as activity. last_active_at moves at most every five
    -- minutes, which is close enough for a limit counted in hours.
    update aarogyam.sessions s
      set revoked_at = now(),
          revoke_reason = case when s.last_active_at < now() - interval '12 hours' then 'idle' else 'expired' end
      where s.provider_session_id = p_session_id and s.revoked_at is null
        and case when exists (select 1 from aarogyam.devices d where d.session_id = s.id)
                 then s.last_active_at < now() - interval '30 days'
                 else s.created_at < now() - interval '7 days' or s.last_active_at < now() - interval '12 hours'
            end;

    insert into aarogyam.sessions (user_id, provider_session_id, audience, expires_at)
    values (v_user_id, p_session_id, 'clinic', p_session_expires_at)
    on conflict (provider_session_id) do update
      set last_active_at = now()
      where aarogyam.sessions.last_active_at < now() - interval '5 minutes'
        and aarogyam.sessions.revoked_at is null;

    return query
      select v_user_id, v_user_status, m.id, m.status, r.key,
             coalesce(array_agg(rp.permission order by rp.permission) filter (where rp.permission is not null), '{}'),
             coalesce(array_agg(rp.scope order by rp.permission) filter (where rp.permission is not null), '{}'),
             exists (select 1 from aarogyam.sessions s
                     where s.provider_session_id = p_session_id
                       and (s.revoked_at is not null or s.user_id <> v_user_id))
      from aarogyam.memberships m
      join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
      left join aarogyam.role_permissions rp on rp.org_id = m.org_id and rp.role_id = m.role_id
      where m.org_id = p_org_id and m.user_id = v_user_id
      group by m.id, m.status, r.key;
  end
  $$;
