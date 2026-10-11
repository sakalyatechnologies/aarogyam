-- WhatsApp on the patient message queue (see 0370, 0375, docs/whatsapp.md). New reasons a
-- message is not sent, WhatsApp's `read` report, and a dispatch that also reports the clinic's
-- template for the message and whether the patient opted in to WhatsApp.
set local lock_timeout = '5s';

-- Expand only: every value allowed before is still allowed.
alter table aarogyam.messages drop constraint messages_skip_reason_check;
alter table aarogyam.messages add constraint messages_skip_reason_check check (skip_reason in (
  'no_consent', 'consent_withdrawn', 'opted_out', 'no_address', 'patient_erased',
  'patient_merged', 'patient_deleted', 'patient_deceased', 'appointment_changed',
  'unsupported', 'channel_disabled', 'no_opt_in', 'template_unavailable', 'template_paused',
  'marketing_limit', 'undeliverable'));
alter table aarogyam.messages drop constraint messages_delivery_check;
alter table aarogyam.messages add constraint messages_delivery_check check (delivery in (
  'sent', 'delivered', 'read', 'delayed', 'bounced', 'complained', 'failed'));
alter table aarogyam.message_events drop constraint message_events_kind_check;
alter table aarogyam.message_events add constraint message_events_kind_check check (kind in (
  'sent', 'delivered', 'read', 'delayed', 'bounced', 'complained', 'failed', 'opened', 'clicked'));

-- As 0371, plus: whether the patient opted in to WhatsApp (any WhatsApp preference row with
-- `whatsapp_opt_in_at`), and the clinic's template for the message's key and channel, in the
-- patient's language if the clinic has it, else English (India), else any.
drop function app.message_dispatch(uuid, uuid);
create function app.message_dispatch(p_org_id uuid, p_message_id uuid)
  returns table (status text, channel text, kind text, purpose text, template_key text,
                 variables jsonb, body text, secret text, address text, may_contact boolean,
                 opted_out boolean, patient_state text, quiet_until timestamptz,
                 clinic_name text, timezone text, portal_host text, appointment_status text,
                 appointment_starts_at timestamptz, doctor_name text, whatsapp_opted_in boolean,
                 template_status text, template_ref text, template_language text,
                 template_category text, template_body text)
  language sql stable security definer set search_path = ''
  as $$
    select m.status, m.channel, m.kind, m.purpose, m.template_key, m.variables, m.body, m.secret,
           case m.channel when 'email' then p.email else p.phone_e164 end,
           app.may_contact(m.org_id, m.patient_id, m.purpose),
           exists (select 1 from aarogyam.contact_preferences c
                   where c.org_id = m.org_id and c.patient_id = m.patient_id
                     and c.channel = m.channel and c.category in ('all', m.purpose) and c.opted_out),
           case when p.status = 'erased' then 'erased'
                when p.status = 'merged' then 'merged'
                when p.deleted_at is not null then 'deleted'
                when p.status = 'deceased' then 'deceased'
                else 'active' end,
           app.message_quiet_until(now(), o.timezone, coalesce(s.notifications, '{}')),
           o.name, o.timezone,
           (select d.hostname from aarogyam.org_domains d
            where d.org_id = m.org_id and d.kind = 'portal' and d.is_primary
              and d.verified_at is not null limit 1),
           a.status, a.starts_at, pr.display_name,
           exists (select 1 from aarogyam.contact_preferences c
                   where c.org_id = m.org_id and c.patient_id = m.patient_id
                     and c.channel = 'whatsapp' and c.whatsapp_opt_in_at is not null),
           t.status, t.provider_template_ref, t.language, t.category, t.body
    from aarogyam.messages m
    join aarogyam.patients p on p.org_id = m.org_id and p.id = m.patient_id
    join aarogyam.organizations o on o.id = m.org_id
    left join aarogyam.org_settings s on s.org_id = m.org_id
    left join aarogyam.appointments a on a.org_id = m.org_id and a.id = m.appointment_id
    left join aarogyam.practitioners pr on pr.org_id = a.org_id and pr.id = a.practitioner_id
    left join lateral (
      select t.status, t.provider_template_ref, t.language, t.category, t.body
      from aarogyam.message_templates t
      where t.org_id = m.org_id and t.key = m.template_key and t.channel = m.channel
      order by (t.language = p.preferred_language) desc, (t.language = 'en-IN') desc, t.language
      limit 1
    ) t on true
    where m.org_id = p_org_id and m.id = p_message_id
  $$;
revoke execute on function app.message_dispatch(uuid, uuid) from public;
grant execute on function app.message_dispatch(uuid, uuid) to aarogyam_api;
