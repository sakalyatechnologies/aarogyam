-- Staff invitations carry the invitee's name (and phone, which the table already had). The name
-- becomes their display name when they join, unless they type their own; an account they already
-- have keeps its name.
alter table aarogyam.invitations
  add column display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 200);

-- Accepting an invitation, as in 0172, except that the invitation's name is the fallback.
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
      left(coalesce(nullif(btrim(p_display_name), ''), v_invitation.display_name, split_part(lower(p_email), '@', 1)), 200)
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
