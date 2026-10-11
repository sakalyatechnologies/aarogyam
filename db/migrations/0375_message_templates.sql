-- What each patient message says, per clinic, channel and language (docs/whatsapp.md). Every
-- clinic gets its own copies of the platform defaults (app.message_template_defaults), seeded
-- when the clinic is created and backfilled here; there is no shared row with a null org_id.
-- `body` holds `{{variable}}` placeholders from the allow-list in code
-- (aarogyam_domain::messaging::allowed_variables). WhatsApp sends only approved templates: the
-- approved text lives at Meta under `provider_template_ref`, and the body here mirrors it so the
-- worker knows the order of the parameters. Email keeps its wording in code for now; its rows say
-- whether the clinic sends it at all (status) and which variables it may carry.
set local lock_timeout = '5s';

create table aarogyam.message_templates (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  key text not null check (key ~ '^[a-z_]+\.[a-z_]+$'),
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  language text not null default 'en-IN' check (language ~ '^[a-z]{2}-[A-Z]{2}$'),
  body text not null check (char_length(btrim(body)) between 1 and 1024),
  -- As Meta categorises it (and returns it on review); email rows use the same words.
  category text not null check (category in ('marketing', 'utility', 'authentication')),
  provider_template_ref text
    check (provider_template_ref ~ '^[a-z0-9_]+$' and char_length(provider_template_ref) <= 512),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'paused')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  -- SMS later (India's DLT registration): the sender header and the registered template id.
  sender_header text check (sender_header ~ '^[A-Z0-9]{3,11}$'),
  dlt_template_id text check (dlt_template_id ~ '^[0-9]{1,30}$'),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, key, channel, language),
  check (channel <> 'whatsapp' or status = 'draft' or provider_template_ref is not null)
);
-- Meta's review webhook names a template by its name and language, across clinics.
create index message_templates_ref on aarogyam.message_templates (provider_template_ref, language)
  where provider_template_ref is not null;
comment on table aarogyam.message_templates is 'sensitivity=internal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.message_templates', 'mutable');

insert into audit.audit_config (table_name, exclude, mask, metadata_only) values
  ('aarogyam.message_templates', '{}', '{}', false);

-- The platform's defaults. Email is approved from the start (no provider review); WhatsApp
-- starts as a draft until Sakalya's templates are approved at Meta (docs/whatsapp.md).
create function app.message_template_defaults()
  returns table (key text, channel text, language text, body text, category text,
                 provider_template_ref text, status text)
  language sql immutable set search_path = ''
  as $$
    values
      ('care.note', 'email', 'en-IN', '{{subject}}', 'utility', null, 'approved'),
      ('reminder.follow_up', 'email', 'en-IN',
       '{{clinic_name}}: your follow-up visit is due {{due_on}}. Book at {{booking_link}}.',
       'utility', null, 'approved'),
      ('promo.offer', 'email', 'en-IN', '{{subject}}', 'marketing', null, 'approved'),
      ('appointment.reminder', 'email', 'en-IN',
       '{{clinic_name}}: a reminder of your appointment on {{appointment_time}} with {{doctor_name}}.',
       'utility', null, 'approved'),
      ('booking.requested', 'email', 'en-IN',
       '{{clinic_name}} received your request for {{when}} with {{doctor_name}}.', 'utility', null, 'approved'),
      ('booking.confirmed', 'email', 'en-IN',
       '{{clinic_name}} confirmed your appointment on {{when}} with {{doctor_name}}.', 'utility', null, 'approved'),
      ('booking.declined', 'email', 'en-IN',
       '{{clinic_name}} could not take your request for {{when}}.', 'utility', null, 'approved'),
      ('prescription.shared', 'email', 'en-IN',
       '{{doctor_name}} at {{clinic_name}} shared your prescription, open until {{expires_on}}.',
       'utility', null, 'approved'),
      ('patient_app.invited', 'email', 'en-IN',
       '{{clinic_name}} invited you to the patient app, until {{expires_on}}.', 'utility', null, 'approved'),
      ('care.note', 'whatsapp', 'en-IN',
       'Message from {{clinic_name}}: {{subject}}. Please call the clinic with any questions.',
       'utility', 'aro_care_note_v1', 'draft'),
      ('reminder.follow_up', 'whatsapp', 'en-IN',
       '{{clinic_name}}: your follow-up visit is due. Book a time at {{booking_link}} or call the clinic.',
       'utility', 'aro_follow_up_v1', 'draft'),
      ('promo.offer', 'whatsapp', 'en-IN',
       '{{clinic_name}}: {{subject}}. Reply STOP to stop these messages.',
       'marketing', 'aro_offer_v1', 'draft'),
      ('appointment.reminder', 'whatsapp', 'en-IN',
       '{{clinic_name}}: a reminder of your appointment on {{appointment_time}} with {{doctor_name}}. Reply STOP to stop reminders.',
       'utility', 'aro_appointment_reminder_v1', 'draft')
  $$;
revoke execute on function app.message_template_defaults() from public;

-- Copies the defaults a clinic doesn't have yet. Safe to repeat; never changes a clinic's edits.
create function app.seed_message_templates(p_org_id uuid)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with added as (
      insert into aarogyam.message_templates (org_id, key, channel, language, body, category,
                                              provider_template_ref, status)
      select p_org_id, d.key, d.channel, d.language, d.body, d.category, d.provider_template_ref,
             d.status
      from app.message_template_defaults() d
      on conflict (org_id, key, channel, language) do nothing
      returning 1
    )
    select count(*)::int from added
  $$;
revoke execute on function app.seed_message_templates(uuid) from public;
grant execute on function app.seed_message_templates(uuid) to aarogyam_api;

create function app.seed_message_templates_for_new_clinic()
  returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    perform app.seed_message_templates(new.id);
    return null;
  end
  $$;
revoke execute on function app.seed_message_templates_for_new_clinic() from public;
create trigger seed_message_templates after insert on aarogyam.organizations
  for each row execute function app.seed_message_templates_for_new_clinic();

select app.seed_message_templates(o.id) from aarogyam.organizations o;
