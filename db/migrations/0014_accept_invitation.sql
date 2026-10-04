-- Accepting an invitation: the invited person joins the clinic.
--
-- The invitation is tied to the email address the person verified when signing in (Supabase
-- sets the `email` claim only after a code or link proves it) and to the invitation's own
-- clinic. Each invitation works once and expires. The person's user record is created on
-- their first acceptance. The API passes the SHA-256 of the token; the token is never stored.
set local lock_timeout = '5s';

create function app.accept_invitation(p_token_hash text, p_auth_uid uuid, p_email text, p_display_name text)
  returns table (org_id uuid, membership_id uuid, outcome text)
  language plpgsql volatile security definer set search_path = ''
  as $$
  -- The output columns (org_id, …) share names with table columns; statements mean the columns.
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

grant execute on function app.accept_invitation(text, uuid, text, text) to aarogyam_api;
