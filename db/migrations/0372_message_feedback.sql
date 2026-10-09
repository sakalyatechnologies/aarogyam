-- What comes back from patients and providers (see 0370): unsubscribe links and provider
-- webhooks (Resend's bounces and complaints). Both arrive with no clinic and no sign-in, so they
-- go through definer functions that find the message by an opaque value: the unsubscribe
-- token's hash, or (provider, provider_message_id).
set local lock_timeout = '5s';

-- Records that the patient opted out of p_channel for p_category (`all` or a purpose), from
-- p_source, and skips their queued messages it covers. Safe to repeat.
create function app.contact_opt_out(p_org_id uuid, p_patient_id uuid, p_channel text,
                                    p_category text, p_source text)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    insert into aarogyam.contact_preferences (org_id, patient_id, channel, category, opted_out,
                                              opted_out_at, source)
    values (p_org_id, p_patient_id, p_channel, p_category, true, now(), p_source)
    on conflict (org_id, patient_id, channel, category) do update
      set opted_out = true,
          opted_out_at = coalesce(aarogyam.contact_preferences.opted_out_at, now()),
          source = case when aarogyam.contact_preferences.opted_out
                        then aarogyam.contact_preferences.source else excluded.source end;
    update aarogyam.messages
      set status = 'skipped', skip_reason = 'opted_out', processed_at = now(), secret = null
      where org_id = p_org_id and patient_id = p_patient_id and channel = p_channel
        and status = 'queued' and (p_category = 'all' or purpose = p_category);
  $$;
revoke execute on function app.contact_opt_out(uuid, uuid, text, text, text) from public;

-- An unsubscribe link was used: the message's patient opts out of email for the message's
-- purpose (reminders or promotional). True when the token named a message; nothing about the
-- patient comes back.
create function app.message_unsubscribe(p_hash text)
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_message record;
  begin
    select m.org_id, m.patient_id, m.channel, m.purpose into v_message
    from aarogyam.messages m
    where m.unsubscribe_hash = p_hash and m.purpose in ('reminders', 'promotional')
    limit 1;
    if v_message.org_id is null then
      return false;
    end if;
    perform app.contact_opt_out(v_message.org_id, v_message.patient_id, v_message.channel,
                                v_message.purpose, 'unsubscribe_link');
    return true;
  end
  $$;
revoke execute on function app.message_unsubscribe(text) from public;
grant execute on function app.message_unsubscribe(text) to aarogyam_api;

-- A provider's webhook event about a message it sent: found by (p_provider,
-- p_provider_message_id). Each event (p_event_id) counts once, whatever order events arrive in:
-- the message keeps the latest report by time, and a bounce or complaint opts the patient out
-- of that channel altogether. Returns `recorded`, `repeat` (seen before) or `unknown` (not a
-- patient message, such as a staff email from the outbox).
create function app.message_provider_event(p_provider text, p_provider_message_id text,
                                           p_event_id text, p_kind text, p_occurred_at timestamptz)
  returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_message record;
    v_inserted int;
  begin
    select m.org_id, m.id, m.patient_id, m.channel into v_message
    from aarogyam.messages m
    where m.provider = p_provider and m.provider_message_id = p_provider_message_id
    limit 1;
    if v_message.org_id is null then
      return 'unknown';
    end if;
    insert into aarogyam.message_events (org_id, message_id, provider, provider_event_id, kind,
                                         occurred_at)
    values (v_message.org_id, v_message.id, p_provider, p_event_id, p_kind, p_occurred_at)
    on conflict (org_id, provider, provider_event_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      return 'repeat';
    end if;
    if p_kind in ('sent', 'delivered', 'delayed', 'bounced', 'complained', 'failed') then
      update aarogyam.messages
        set delivery = p_kind, delivery_at = p_occurred_at
        where org_id = v_message.org_id and id = v_message.id
          and (delivery_at is null or delivery_at <= p_occurred_at)
          -- A bounce or complaint is final: a late `delivered` doesn't undo it.
          and coalesce(delivery, '') not in ('bounced', 'complained');
    end if;
    if p_kind in ('bounced', 'complained') then
      perform app.contact_opt_out(v_message.org_id, v_message.patient_id, v_message.channel, 'all',
                                  case p_kind when 'bounced' then 'bounce' else 'complaint' end);
    end if;
    return 'recorded';
  end
  $$;
revoke execute on function app.message_provider_event(text, text, text, text, timestamptz) from public;
grant execute on function app.message_provider_event(text, text, text, text, timestamptz) to aarogyam_api;
