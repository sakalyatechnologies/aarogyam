-- Patient messages get their own queue (docs/decisions.md, "Patient messaging core"). The outbox
-- (0017) stays for staff, system and lab email and is not changed; every message to a patient
-- (booking answers, prescription links, app invitations, appointment reminders, messages staff
-- send) is a `messages` row instead, addressed only when it is sent: the row holds the patient's
-- id, never an address. The worker claims rows with app.messages_claim and reads everything it
-- needs at send time through app.message_dispatch (0371), so consent, opt-outs, quiet hours and
-- the patient's state are checked when the message leaves, not when it was queued.
--
-- messages.send (front desk, doctor, owner) lets staff message patients (POST /messages).
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description) values
  ('messages.send', 'messages', 'Send patients email messages from the clinic');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, 'messages.send', 'all' from aarogyam.role_templates t
where t.key in ('owner', 'doctor', 'front_desk');

-- Clinics that exist already got their standard roles from the templates; give those the same.
insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null and tp.permission = 'messages.send'
on conflict do nothing;

-- What a patient asked for, per channel and category: an opt-out (by staff, an unsubscribe link,
-- a bounce or complaint, later a WhatsApp STOP) and, for WhatsApp, when they opted in. Consent
-- (patient_consents, app.may_contact) says whether the clinic may message for a purpose at all;
-- this says the patient doesn't want a channel. Category `all` covers every purpose.
create table aarogyam.contact_preferences (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  category text not null check (category in ('all', 'care', 'reminders', 'promotional')),
  opted_out boolean not null default false,
  opted_out_at timestamptz,
  whatsapp_opt_in_at timestamptz,
  source text not null
    check (source in ('staff', 'patient', 'unsubscribe_link', 'bounce', 'complaint', 'stop_keyword')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, patient_id, channel, category),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  check (opted_out = (opted_out_at is not null)),
  check (whatsapp_opt_in_at is null or channel = 'whatsapp')
);
comment on table aarogyam.contact_preferences is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.contact_preferences', 'mutable');

-- One message to one patient on one channel. `variables` holds ids and the non-patient values a
-- template needs (clinic, doctor, time, a subject staff typed); `body` is free text staff wrote,
-- email only. `secret` is a one-time link secret (a share token, an app link code), cleared once
-- the message is sent, skipped or abandoned. `dedupe_key` makes re-runs harmless: a reminder job
-- that runs twice, a staff member who presses send twice, queue one message.
create table aarogyam.messages (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  kind text not null check (kind ~ '^[a-z_]+\.[a-z_]+$'),
  purpose text not null check (purpose in ('care', 'reminders', 'promotional')),
  template_key text not null check (template_key ~ '^[a-z_]+\.[a-z_]+$'),
  variables jsonb not null default '{}'
    check (jsonb_typeof(variables) = 'object' and octet_length(variables::text) <= 4000),
  body text check (char_length(btrim(body)) between 1 and 5000),
  secret text check (char_length(secret) <= 200),
  appointment_id uuid,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  skip_reason text check (skip_reason in (
    'no_consent', 'consent_withdrawn', 'opted_out', 'no_address', 'patient_erased',
    'patient_merged', 'patient_deleted', 'patient_deceased', 'appointment_changed',
    'unsupported')),
  dedupe_key text check (char_length(dedupe_key) between 1 and 200),
  scheduled_for timestamptz not null default now(),
  -- While `sending`: when the worker's claim lapses and another worker may retry.
  lease_until timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  last_error text check (char_length(last_error) <= 200),
  provider text check (provider in ('log', 'resend', 'meta', 'sms')),
  provider_message_id text check (char_length(provider_message_id) <= 200),
  cost_paise bigint check (cost_paise >= 0),
  -- SHA-256 (hex) of the opaque unsubscribe token in a reminder or promotional email.
  unsubscribe_hash text check (unsubscribe_hash ~ '^[0-9a-f]{64}$'),
  -- What the provider last reported (webhooks), kept with its time so late events can't
  -- overwrite newer ones.
  delivery text check (delivery in ('sent', 'delivered', 'delayed', 'bounced', 'complained', 'failed')),
  delivery_at timestamptz,
  sent_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, dedupe_key),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, appointment_id) references aarogyam.appointments (org_id, id),
  check (body is null or channel = 'email'),
  check ((status = 'skipped') = (skip_reason is not null)),
  check ((status = 'sent') = (sent_at is not null)),
  check ((status in ('queued', 'sending')) = (processed_at is null)),
  check ((status = 'sending') = (lease_until is not null)),
  check (status in ('queued', 'sending') or secret is null),
  check ((delivery is null) = (delivery_at is null))
);
-- The worker's queue across clinics, and claims that lapsed.
create index messages_due on aarogyam.messages (scheduled_for) where status = 'queued';
create index messages_leased on aarogyam.messages (lease_until) where status = 'sending';
-- A patient's messages, newest first; withdrawals and opt-outs find queued ones here.
create index messages_patient on aarogyam.messages (org_id, patient_id, created_at desc);
create index messages_appointment on aarogyam.messages (org_id, appointment_id)
  where appointment_id is not null;
-- Webhooks find a message by the provider's id, with no clinic to hand (unique per clinic, and
-- in practice across them: providers' ids are); the budget counts today's sends per provider.
create unique index messages_org_provider_message
  on aarogyam.messages (org_id, provider, provider_message_id) where provider_message_id is not null;
create index messages_provider_message on aarogyam.messages (provider, provider_message_id)
  where provider_message_id is not null;
create index messages_sent_by_provider on aarogyam.messages (provider, sent_at) where sent_at is not null;
-- The unsubscribe link finds its message by the token's hash (192 random bits: no collisions).
create index messages_unsubscribe on aarogyam.messages (unsubscribe_hash)
  where unsubscribe_hash is not null;
-- The retention report (1 year from queuing).
create index messages_created on aarogyam.messages (created_at);
comment on table aarogyam.messages is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.messages', 'mutable');

-- What providers report about a sent message (delivered, bounced, complained), from their
-- webhooks. Metadata only: the provider's event id, the kind and its time, never the payload.
create table aarogyam.message_events (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  message_id uuid not null,
  provider text not null check (provider in ('log', 'resend', 'meta', 'sms')),
  -- The provider's id for the event (Svix's `svix-id` for Resend): a repeat is ignored.
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 200),
  kind text not null
    check (kind in ('sent', 'delivered', 'delayed', 'bounced', 'complained', 'failed', 'opened', 'clicked')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, provider, provider_event_id),
  foreign key (org_id, message_id) references aarogyam.messages (org_id, id)
);
create index message_events_message on aarogyam.message_events (org_id, message_id);
comment on table aarogyam.message_events is 'sensitivity=internal offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.message_events', 'append_only');

-- The change history keeps who queued a message, its outcome and why it was skipped; never the
-- text, the template values (a subject staff typed), the secret or the unsubscribe hash.
insert into audit.audit_config (table_name, exclude, mask, metadata_only) values
  ('aarogyam.messages', '{attempts,lease_until,delivery_at}',
   '{body,variables,secret,last_error,unsubscribe_hash}', false),
  ('aarogyam.contact_preferences', '{}', '{}', false),
  ('aarogyam.message_events', '{}', '{}', true);

-- Erasure (0345): a patient's messages, their provider events and their preferences go. Events
-- name no patient, so they are found through their message, and go first.
insert into audit.erasure_steps (table_name, step_order, action, set_clause, filter, note) values
  ('aarogyam.message_events', 36, 'delete', null,
   'message_id in (select m.id from aarogyam.messages m where m.org_id = $1 and m.patient_id = $2)',
   'provider events of the patient''s messages'),
  ('aarogyam.messages', 37, 'delete', null, 'patient_id = $2', 'messages to the patient'),
  ('aarogyam.contact_preferences', 38, 'delete', null, 'patient_id = $2',
   'channel opt-outs and opt-ins');
