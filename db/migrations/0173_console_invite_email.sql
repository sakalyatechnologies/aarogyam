-- The console's clinic creation queues the owner's invitation email, as approving an
-- application does, and the console can send an owner's invitation again.
set local lock_timeout = '5s';

-- Creates a clinic with its owner's invitation (app.console_create_clinic) and queues the
-- invitation email in the new clinic's outbox, in one transaction. The payload gets the
-- invitation id added here; the token is only the message's secret.
create function app.console_create_clinic_invited(
  p_slug text, p_name text, p_number_prefix text, p_specialty text, p_portal_host text,
  p_owner_email text, p_invite_token_hash text, p_invite_expires_at timestamptz, p_created_by uuid,
  p_message_id uuid, p_message_event text, p_message_payload jsonb, p_message_secret text)
  returns table (org_id uuid, invitation_id uuid)
  language plpgsql volatile security definer set search_path = ''
  as $$
  #variable_conflict use_column
  declare
    v_org uuid;
    v_invitation uuid;
  begin
    select c.org_id, c.invitation_id into v_org, v_invitation
      from app.console_create_clinic(p_slug, p_name, p_number_prefix, p_specialty, p_portal_host,
                                     p_owner_email, p_invite_token_hash, p_invite_expires_at,
                                     p_created_by) c;
    insert into aarogyam.outbox_events (org_id, id, event_key, channel, recipient, payload, secret)
    values (v_org, p_message_id, p_message_event, 'email', lower(p_owner_email),
            p_message_payload || jsonb_build_object('invitation_id', v_invitation), p_message_secret);
    return query select v_org, v_invitation;
  end
  $$;

-- Sends a clinic's owner invitation again while the owner hasn't accepted it (expired or not):
-- the first owner invitation gets a new token and expiry, so the previous link stops working,
-- and a new email is queued; emails still waiting for the old link are abandoned. Outcome
-- `resent`, `accepted` (the owner already joined) or `none` (no owner invitation).
create function app.console_resend_owner_invitation(
  p_org_id uuid, p_token_hash text, p_expires_at timestamptz, p_resent_by uuid,
  p_message_id uuid, p_message_event text, p_message_payload jsonb, p_message_secret text)
  returns table (invitation_id uuid, email text, outcome text)
  language plpgsql volatile security definer set search_path = ''
  as $$
  #variable_conflict use_column
  declare
    v_id uuid;
    v_email text;
    v_accepted timestamptz;
  begin
    select i.id, i.email, i.accepted_at into v_id, v_email, v_accepted
      from aarogyam.invitations i
      join aarogyam.roles r on r.org_id = i.org_id and r.id = i.role_id
      where i.org_id = p_org_id and r.key = 'owner' and i.email is not null
      order by i.created_at, i.id
      limit 1
      for update of i;
    if not found then
      return query select null::uuid, null::text, 'none'::text;
      return;
    end if;
    if v_accepted is not null then
      return query select v_id, v_email, 'accepted'::text;
      return;
    end if;
    update aarogyam.outbox_events o
      set status = 'failed', processed_at = now(), secret = null, last_error = 'superseded'
      where o.org_id = p_org_id and o.status = 'pending' and o.event_key = p_message_event
        and o.payload ->> 'invitation_id' = v_id::text;
    update aarogyam.invitations i
      set token_hash = p_token_hash, expires_at = p_expires_at, updated_at = now(),
          updated_by = p_resent_by
      where i.org_id = p_org_id and i.id = v_id;
    insert into aarogyam.outbox_events (org_id, id, event_key, channel, recipient, payload, secret)
    values (p_org_id, p_message_id, p_message_event, 'email', v_email,
            p_message_payload || jsonb_build_object('invitation_id', v_id), p_message_secret);
    return query select v_id, v_email, 'resent'::text;
  end
  $$;

grant execute on function app.console_create_clinic_invited(text, text, text, text, text, text, text, timestamptz, uuid, uuid, text, jsonb, text)
  to aarogyam_api;
grant execute on function app.console_resend_owner_invitation(uuid, text, timestamptz, uuid, uuid, text, jsonb, text)
  to aarogyam_api;
