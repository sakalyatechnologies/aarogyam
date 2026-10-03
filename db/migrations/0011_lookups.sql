-- Lookups that run before the clinic is known, and clinic creation.
--
-- These are SECURITY DEFINER: they run as the owner, which row-level security does not
-- restrict, so each one filters explicitly and returns only what its caller needs.
-- search_path is empty and every name is qualified, so nothing can be substituted.
-- Execute is granted to exactly one role.
set local lock_timeout = '5s';

-- Host name → clinic. Only verified hosts resolve. The API caches the answer briefly.
create function app.resolve_host(p_host text)
  returns table (org_id uuid, slug text, org_status text, domain_kind text)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.slug, o.status, d.kind
    from aarogyam.org_domains d
    join aarogyam.organizations o on o.id = d.org_id
    where d.hostname = lower(p_host) and d.verified_at is not null
  $$;

-- Everything the API needs to authorise a request to a clinic, in one round trip: the
-- user behind the Supabase token, their membership and role in this clinic, the role's
-- permissions, and whether this sign-in session has been revoked. The API decides; this
-- only reports. No row means the person is not a member of this clinic.
-- A session seen for the first time is remembered, so it can be revoked later.
create function app.authorize(p_org_id uuid, p_auth_uid uuid, p_session_id uuid, p_session_expires_at timestamptz)
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

    insert into aarogyam.sessions (user_id, provider_session_id, audience, expires_at)
    values (v_user_id, p_session_id, 'clinic', p_session_expires_at)
    on conflict (provider_session_id) do update
      set last_active_at = now()
      where aarogyam.sessions.last_active_at < now() - interval '5 minutes';

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

-- The clinics a person belongs to, for the clinic switcher on the neutral host.
create function app.my_clinics(p_auth_uid uuid)
  returns table (org_id uuid, slug text, name text, org_status text, role_key text, role_name text,
                 membership_status text, portal_host text)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.slug, o.name, o.status, r.key, r.name, m.status,
           (select d.hostname from aarogyam.org_domains d
             where d.org_id = o.id and d.kind = 'portal' and d.is_primary and d.verified_at is not null)
    from aarogyam.users u
    join aarogyam.memberships m on m.user_id = u.id
    join aarogyam.organizations o on o.id = m.org_id
    join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
    where u.auth_uid = p_auth_uid and m.status in ('invited', 'active')
    order by o.name
  $$;

grant execute on function app.resolve_host(text) to aarogyam_api;
grant execute on function app.authorize(uuid, uuid, uuid, timestamptz) to aarogyam_api;
grant execute on function app.my_clinics(uuid) to aarogyam_api;

-- Creates a clinic with its portal host, a default branch, settings, the template roles
-- and, when given, an active owner. Used by the console (its own role, granted when the
-- console is built) and by seeds.
create function app.create_clinic(
  p_slug text, p_name text, p_number_prefix text, p_specialty text, p_portal_host text,
  p_owner_user_id uuid default null)
  returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_org uuid;
  begin
    insert into aarogyam.organizations (slug, name, number_prefix, specialty)
    values (p_slug, p_name, p_number_prefix, p_specialty)
    returning id into v_org;

    insert into aarogyam.org_domains (org_id, hostname, kind, is_primary, verified_at)
    values (v_org, lower(p_portal_host), 'portal', true, now());

    insert into aarogyam.branches (org_id, slug, name, is_default)
    values (v_org, 'main', p_name, true);

    insert into aarogyam.org_settings (org_id) values (v_org);

    insert into aarogyam.roles (org_id, key, name, is_template, description)
    select v_org, t.key, t.name, true, t.description from aarogyam.role_templates t;

    insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
    select v_org, r.id, tp.permission, tp.scope
    from aarogyam.roles r
    join aarogyam.role_templates t on t.key = r.key
    join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
    where r.org_id = v_org;

    if p_owner_user_id is not null then
      insert into aarogyam.memberships (org_id, user_id, role_id, status, joined_at)
      select v_org, p_owner_user_id, r.id, 'active', now()
      from aarogyam.roles r where r.org_id = v_org and r.key = 'owner';
    end if;

    return v_org;
  end
  $$;
