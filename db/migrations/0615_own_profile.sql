-- A person's own profile and "sign out everywhere else" (portal v2, Settings). Like the session
-- functions of 0016, these run before any clinic is known for a person identified only by the
-- Supabase Auth id in their verified token: SECURITY DEFINER, filtering by that id themselves,
-- touching only the person's own rows, executable only by the API's login. The change history
-- records the person as the actor (app.user_id).
set local lock_timeout = '5s';

-- The person's own name and phone. A null name or p_set_phone = false leaves that value as it is;
-- p_set_phone with a null phone clears it. Returns the profile now, or no row for an unknown
-- person. A phone another account holds raises unique_violation (the API answers 409).
create function app.update_my_profile(p_auth_uid uuid, p_display_name text, p_phone_e164 text,
                                      p_set_phone boolean)
  returns table (display_name text, phone_e164 text)
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_user_id uuid;
  begin
    select u.id into v_user_id from aarogyam.users u
      where u.auth_uid = p_auth_uid and u.status = 'active';
    if v_user_id is null then
      return;
    end if;
    perform set_config('app.user_id', v_user_id::text, true);
    return query
      update aarogyam.users u
        set display_name = coalesce(p_display_name, u.display_name),
            phone_e164 = case when p_set_phone then p_phone_e164 else u.phone_e164 end
        where u.id = v_user_id
        returning u.display_name, u.phone_e164;
  end
  $$;

-- The person's own name and phone, for the profile form.
create function app.my_profile(p_auth_uid uuid)
  returns table (display_name text, phone_e164 text)
  language sql stable security definer set search_path = ''
  as $$
    select u.display_name, u.phone_e164 from aarogyam.users u
    where u.auth_uid = p_auth_uid and u.status = 'active'
  $$;

-- Signs out every other session of the person (all audiences), keeping the one asking, and
-- returns their provider session ids so the API can drop anything it cached for them. Sessions
-- already revoked or expired are left alone.
create function app.revoke_other_sessions(p_auth_uid uuid, p_current_session uuid)
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
        set revoked_at = now(), revoke_reason = 'signed_out_others'
        where s.user_id = v_user_id and s.revoked_at is null and s.expires_at > now()
          and s.provider_session_id <> p_current_session
        returning s.provider_session_id;
  end
  $$;

revoke execute on function app.update_my_profile(uuid, text, text, boolean) from public;
revoke execute on function app.my_profile(uuid) from public;
revoke execute on function app.revoke_other_sessions(uuid, uuid) from public;
grant execute on function app.update_my_profile(uuid, text, text, boolean) to aarogyam_api;
grant execute on function app.my_profile(uuid) to aarogyam_api;
grant execute on function app.revoke_other_sessions(uuid, uuid) to aarogyam_api;

-- A staff member's phone is personal data: the change history records that it changed, not the
-- number.
update audit.audit_config set mask = array_append(mask, 'phone_e164')
  where table_name = 'aarogyam.users' and not ('phone_e164' = any(mask));
