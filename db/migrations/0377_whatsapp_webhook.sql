-- What Meta's WhatsApp webhook reports (docs/whatsapp.md): message statuses, STOP replies and
-- template reviews. It arrives with no clinic and no sign-in, signed with the app secret, so it
-- goes through these definer functions. An inbound message's text never reaches the database:
-- the API checks it for a STOP keyword and passes on only the sender's phone.
set local lock_timeout = '5s';

-- STOP finds a phone's patients across clinics.
create index patients_phone_e164 on aarogyam.patients (phone_e164) where phone_e164 is not null;

-- A status of a message Meta sent (`sent`, `delivered`, `read`, `failed`), found by its wamid.
-- Each status counts once per message (event id `<wamid>:<status>`); the message keeps the
-- furthest one (sent < delivered < read; failed is final), whatever order they arrive in, as
-- Meta's timestamps are whole seconds and often equal. Returns `recorded`, `repeat` or `unknown`.
create function app.whatsapp_status(p_wamid text, p_status text, p_occurred_at timestamptz)
  returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_message record;
    v_inserted int;
    v_rank constant jsonb := '{"sent": 1, "delivered": 2, "read": 3, "failed": 4}';
  begin
    if p_status not in ('sent', 'delivered', 'read', 'failed') then
      return 'unknown';
    end if;
    select m.org_id, m.id into v_message
    from aarogyam.messages m
    where m.provider = 'meta' and m.provider_message_id = p_wamid
    limit 1;
    if v_message.org_id is null then
      return 'unknown';
    end if;
    insert into aarogyam.message_events (org_id, message_id, provider, provider_event_id, kind,
                                         occurred_at)
    values (v_message.org_id, v_message.id, 'meta', left(p_wamid, 180) || ':' || p_status,
            p_status, p_occurred_at)
    on conflict (org_id, provider, provider_event_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      return 'repeat';
    end if;
    update aarogyam.messages
      set delivery = p_status, delivery_at = p_occurred_at
      where org_id = v_message.org_id and id = v_message.id
        and coalesce((v_rank->>delivery)::int, 0) < (v_rank->>p_status)::int;
    return 'recorded';
  end
  $$;
revoke execute on function app.whatsapp_status(text, text, timestamptz) from public;
grant execute on function app.whatsapp_status(text, text, timestamptz) to aarogyam_api;

-- A STOP reply from p_phone (E.164). The shared Sakalya number serves every clinic, so the
-- clinic is: the one whose message the reply quotes (p_context_wamid); else the one that last
-- sent this phone a WhatsApp message in the past 30 days; else, to be safe, every clinic that
-- ever queued a WhatsApp message to it. Every patient at that clinic with the phone opts out of
-- WhatsApp altogether (queued ones are skipped). Returns how many clinics.
create function app.whatsapp_stop(p_phone text, p_context_wamid text)
  returns int
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_orgs uuid[];
    v_patient record;
  begin
    select array[m.org_id] into v_orgs
    from aarogyam.messages m
    join aarogyam.patients p on p.org_id = m.org_id and p.id = m.patient_id
    where p_context_wamid is not null and m.provider = 'meta'
      and m.provider_message_id = p_context_wamid and p.phone_e164 = p_phone
    limit 1;
    if v_orgs is null then
      select array[m.org_id] into v_orgs
      from aarogyam.patients p
      join aarogyam.messages m on m.org_id = p.org_id and m.patient_id = p.id
      where p.phone_e164 = p_phone and m.channel = 'whatsapp' and m.status = 'sent'
        and m.sent_at > now() - interval '30 days'
      order by m.sent_at desc
      limit 1;
    end if;
    if v_orgs is null then
      select array_agg(distinct m.org_id) into v_orgs
      from aarogyam.patients p
      join aarogyam.messages m on m.org_id = p.org_id and m.patient_id = p.id
      where p.phone_e164 = p_phone and m.channel = 'whatsapp';
    end if;
    for v_patient in
      select p.org_id, p.id from aarogyam.patients p
      where p.phone_e164 = p_phone and p.org_id = any (coalesce(v_orgs, '{}'))
    loop
      perform app.contact_opt_out(v_patient.org_id, v_patient.id, 'whatsapp', 'all',
                                  'stop_keyword');
    end loop;
    return coalesce(cardinality(v_orgs), 0);
  end
  $$;
revoke execute on function app.whatsapp_stop(text, text) from public;
grant execute on function app.whatsapp_stop(text, text) to aarogyam_api;

-- Meta reviewed a template of Sakalya's account (`message_template_status_update`): every
-- clinic copy with that name and language that was submitted (or reviewed before) takes the
-- new status. Drafts stay drafts. Meta's language is `en`, `en_US`...; ours `en-IN`: the
-- primary subtag is compared. Returns how many copies changed.
create function app.whatsapp_template_reviewed(p_ref text, p_language text, p_status text)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with changed as (
      update aarogyam.message_templates
        set status = p_status, reviewed_at = now()
        where channel = 'whatsapp' and provider_template_ref = p_ref
          and split_part(language, '-', 1) = split_part(replace(p_language, '_', '-'), '-', 1)
          and status <> 'draft' and status <> p_status
          and p_status in ('approved', 'rejected', 'paused')
        returning 1
    )
    select count(*)::int from changed
  $$;
revoke execute on function app.whatsapp_template_reviewed(text, text, text) from public;
grant execute on function app.whatsapp_template_reviewed(text, text, text) to aarogyam_api;

-- What Meta last decided about a template name, language and text, from any clinic's copy:
-- a clinic submitting a copy Meta already approved for another clinic on the shared number
-- takes that status at once. Null when no copy was reviewed.
create function app.whatsapp_template_known_status(p_ref text, p_language text, p_body text)
  returns text
  language sql stable security definer set search_path = ''
  as $$
    select t.status from aarogyam.message_templates t
    where t.channel = 'whatsapp' and t.provider_template_ref = p_ref and t.language = p_language
      and t.body = p_body and t.status in ('approved', 'rejected', 'paused')
    order by t.reviewed_at desc nulls last
    limit 1
  $$;
revoke execute on function app.whatsapp_template_known_status(text, text, text) from public;
grant execute on function app.whatsapp_template_known_status(text, text, text) to app_user;
