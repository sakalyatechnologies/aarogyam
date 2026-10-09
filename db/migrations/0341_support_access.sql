-- How support grants are used (0340): the lookups behind the grant screens, the check a request
-- under a grant passes before its clinic transaction, and read-only support in the database.
set local lock_timeout = '5s';

-- Support access to a clinic in one round trip, like app.authorize for members: the person is
-- active Sakalya staff (owner or support role) with a grant at this clinic that has started, not
-- ended and not been revoked. Records the sign-in session (so it can be revoked) and, unless it
-- was revoked, the action under the grant. No row: no usable grant.
create function app.support_authorize(
  p_org_id uuid, p_auth_uid uuid, p_session_id uuid, p_session_expires_at timestamptz,
  p_method text, p_route text, p_request_id text)
  returns table (user_id uuid, grant_id uuid, access text, ends_at timestamptz, session_revoked boolean)
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_user uuid;
    v_grant aarogyam.support_grants%rowtype;
    v_revoked boolean;
  begin
    select u.id into v_user
      from aarogyam.users u join aarogyam.platform_users p on p.user_id = u.id
      where u.auth_uid = p_auth_uid and u.status = 'active' and p.active and p.role in ('owner', 'support');
    if v_user is null then
      return;
    end if;
    select g.* into v_grant
      from aarogyam.support_grants g join aarogyam.platform_users p on p.id = g.platform_user_id
      where g.org_id = p_org_id and p.user_id = v_user and g.revoked_at is null
        and g.starts_at <= now() and g.ends_at > now()
      order by g.ends_at desc
      limit 1;
    if v_grant.id is null then
      return;
    end if;

    insert into aarogyam.sessions (user_id, provider_session_id, audience, expires_at)
    values (v_user, p_session_id, 'platform', p_session_expires_at)
    on conflict (provider_session_id) do update
      set last_active_at = now()
      where aarogyam.sessions.last_active_at < now() - interval '5 minutes';
    select exists (select 1 from aarogyam.sessions s
                   where s.provider_session_id = p_session_id
                     and (s.revoked_at is not null or s.user_id <> v_user))
      into v_revoked;
    if not v_revoked then
      insert into audit.support_actions (org_id, grant_id, user_id, method, route, request_id)
      values (p_org_id, v_grant.id, v_user, p_method, left(p_route, 200), p_request_id);
    end if;
    return query select v_user, v_grant.id, v_grant.access, v_grant.ends_at, v_revoked;
  end
  $$;

-- The staff member a clinic owner names by email when granting access: active staff with the
-- owner or support role only. Inside a staff member's clinic transaction only.
create function app.support_staff_by_email(p_email text)
  returns table (platform_user_id uuid, display_name text)
  language sql stable security definer set search_path = ''
  as $$
    select p.id, u.display_name
    from aarogyam.users u join aarogyam.platform_users p on p.user_id = u.id
    where u.email = lower(btrim(p_email)) and u.status = 'active' and p.active
      and p.role in ('owner', 'support')
      and app.actor_kind() = 'staff' and app.tenant_id() is not null
  $$;

-- The name and email of a staff member who holds (or held) a grant at the current clinic, for
-- the clinic's list of grants. Nothing for anyone else.
create function app.support_staff_name(p_platform_user_id uuid)
  returns table (display_name text, email text)
  language sql stable security definer set search_path = ''
  as $$
    select u.display_name, u.email
    from aarogyam.platform_users p join aarogyam.users u on u.id = p.user_id
    where p.id = p_platform_user_id
      and exists (select 1 from aarogyam.support_grants g
                  where g.org_id = app.tenant_id() and g.platform_user_id = p.id)
  $$;

-- The grants a staff member holds, for the console: every clinic, newest end first.
create function app.my_support_grants(p_user_id uuid)
  returns table (grant_id uuid, org_id uuid, slug text, clinic_name text, portal_host text,
                 access text, reason text, starts_at timestamptz, ends_at timestamptz,
                 revoked_at timestamptz, granted_by_name text)
  language sql stable security definer set search_path = ''
  as $$
    select g.id, o.id, o.slug, o.name,
           (select d.hostname from aarogyam.org_domains d
             where d.org_id = o.id and d.kind = 'portal' and d.is_primary and d.verified_at is not null),
           g.access, g.reason, g.starts_at, g.ends_at, g.revoked_at, gu.display_name
    from aarogyam.platform_users p
    join aarogyam.support_grants g on g.platform_user_id = p.id
    join aarogyam.organizations o on o.id = g.org_id
    join aarogyam.memberships m on m.org_id = g.org_id and m.id = g.granted_by
    join aarogyam.users gu on gu.id = m.user_id
    where p.user_id = p_user_id
    order by g.ends_at desc, g.id
    limit 100
  $$;

-- Support is read-only (docs/decisions.md): every clinic table's insert and update passes this
-- trigger, so a support request that tries to write fails even if a route forgot to refuse it.
create or replace function app.set_row_meta() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if app.actor_kind() = 'support' then
      raise exception 'support access is read-only' using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'INSERT' then
      new.created_at := now();
      new.created_by := app.user_id();
    else
      new.created_at := old.created_at;
      new.created_by := old.created_by;
    end if;
    new.updated_at := now();
    new.updated_by := app.user_id();
    return new;
  end
  $$;

grant execute on function app.support_authorize(uuid, uuid, uuid, timestamptz, text, text, text) to aarogyam_api;
grant execute on function app.my_support_grants(uuid) to aarogyam_api;
grant execute on function app.support_staff_by_email(text), app.support_staff_name(uuid) to app_user;
revoke execute on function app.support_authorize(uuid, uuid, uuid, timestamptz, text, text, text) from public;
revoke execute on function app.my_support_grants(uuid) from public;
revoke execute on function app.support_staff_by_email(text), app.support_staff_name(uuid) from public;
