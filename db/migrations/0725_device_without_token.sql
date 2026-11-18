-- An app install registers at sign-in even before it has a push token (Android has no push
-- provider yet; an iPhone whose person declined notifications never gets one), so the session it
-- signed in with is known to be a phone's: phone sessions end after 30 idle days, browsers after
-- 12 hours (0723). p_token may now be null: the install is recorded, a token it already has is
-- kept, and nothing is pushed to it until a token arrives.
set local lock_timeout = '5s';

create or replace function app.register_device(
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
    if p_token is not null then
      update aarogyam.devices d set push_token = null, push_token_updated_at = now()
        where d.push_token = p_token
          and (d.user_id <> v_user_id or d.installation_id is distinct from p_installation_id);
    end if;
    insert into aarogyam.devices (user_id, installation_id, platform, push_token,
                                  push_token_updated_at, app, locale, app_version, session_id)
      values (v_user_id, p_installation_id, p_platform, p_token,
              case when p_token is null then null else now() end, p_app, p_locale,
              p_app_version, v_session_id)
      on conflict (user_id, installation_id) do update
        set platform = excluded.platform,
            push_token = coalesce(excluded.push_token, aarogyam.devices.push_token),
            push_token_updated_at = coalesce(excluded.push_token_updated_at, aarogyam.devices.push_token_updated_at),
            app = excluded.app, locale = excluded.locale, app_version = excluded.app_version,
            session_id = excluded.session_id;
    return true;
  end
  $$;
