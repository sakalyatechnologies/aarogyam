-- Sakalya staff and clinic accounts are separate people. A person with an active platform_users
-- row can't hold an active clinic membership or accept a clinic invitation, and can't be made
-- staff while they hold one. Support work in a clinic goes through support grants only. The
-- last active platform owner can't be removed, so the console always has someone to run it.
--
-- The checks are triggers, so they hold for the console, the CLI and any SQL over the owner
-- connection. Existing rows are not checked: fix them with `aarogyam platform revoke` first.
set local lock_timeout = '5s';

-- Definer, because the clinic role that edits memberships can't read platform_users.
create function app.forbid_staff_membership() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.status = 'active' and exists (
      select 1 from aarogyam.platform_users p where p.user_id = new.user_id and p.active
    ) then
      raise exception 'Sakalya platform staff cannot hold a clinic membership; use a support grant'
        using errcode = 'AP001';
    end if;
    return new;
  end
  $$;
create trigger forbid_staff before insert or update of user_id, status on aarogyam.memberships
  for each row execute function app.forbid_staff_membership();

create function app.guard_platform_users() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if tg_op <> 'DELETE' and new.active and exists (
      select 1 from aarogyam.memberships m where m.user_id = new.user_id and m.status = 'active'
    ) then
      raise exception 'this person holds an active clinic membership; platform access needs an account with no clinic membership'
        using errcode = 'AP001';
    end if;
    if tg_op <> 'INSERT' and old.active and old.role = 'owner'
       and (tg_op = 'DELETE' or not new.active or new.role <> 'owner') then
      perform pg_advisory_xact_lock(hashtext('aarogyam.platform_owners'));
      if not exists (
        select 1 from aarogyam.platform_users p
        where p.active and p.role = 'owner' and p.id <> old.id
      ) then
        raise exception 'refusing to remove the last active platform owner; grant another owner first'
          using errcode = 'AP002';
      end if;
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end
  $$;
create trigger guard before insert or update or delete on aarogyam.platform_users
  for each row execute function app.guard_platform_users();

-- Accepting an invitation, as in 0014, except that platform staff are refused.
create or replace function app.accept_invitation(p_token_hash text, p_auth_uid uuid, p_email text, p_display_name text)
  returns table (org_id uuid, membership_id uuid, outcome text)
  language plpgsql volatile security definer set search_path = ''
  as $$
  #variable_conflict use_column
  declare
    v_invitation aarogyam.invitations%rowtype;
    v_user_id uuid;
    v_user_status text;
    v_membership_id uuid;
  begin
    select * into v_invitation
      from aarogyam.invitations i
      where i.token_hash = p_token_hash
      for update;
    if not found or v_invitation.accepted_at is not null or v_invitation.expires_at <= now() then
      return query select null::uuid, null::uuid, 'invalid'::text;
      return;
    end if;
    if v_invitation.email is null or v_invitation.email <> lower(coalesce(p_email, '')) then
      return query select null::uuid, null::uuid, 'wrong_email'::text;
      return;
    end if;

    insert into aarogyam.users (auth_uid, email, display_name)
    values (
      p_auth_uid,
      lower(p_email),
      left(coalesce(nullif(btrim(p_display_name), ''), split_part(lower(p_email), '@', 1)), 200)
    )
    on conflict (auth_uid) do nothing;
    select u.id, u.status into v_user_id, v_user_status
      from aarogyam.users u where u.auth_uid = p_auth_uid;
    if v_user_status <> 'active' then
      return query select null::uuid, null::uuid, 'disabled'::text;
      return;
    end if;
    if exists (select 1 from aarogyam.platform_users p where p.user_id = v_user_id and p.active) then
      return query select null::uuid, null::uuid, 'platform_staff'::text;
      return;
    end if;

    insert into aarogyam.memberships as m (org_id, user_id, role_id, status, joined_at)
    values (v_invitation.org_id, v_user_id, v_invitation.role_id, 'active', now())
    on conflict (org_id, user_id) do update
      set role_id = excluded.role_id, status = 'active', joined_at = coalesce(m.joined_at, now())
    returning m.id into v_membership_id;

    update aarogyam.invitations i
      set accepted_at = now()
      where i.org_id = v_invitation.org_id and i.id = v_invitation.id;

    return query select v_invitation.org_id, v_membership_id, 'accepted'::text;
  end
  $$;
