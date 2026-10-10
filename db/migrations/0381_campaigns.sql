-- Campaigns (see 0380): a one-off promotional send of a clinic's template to an audience.
-- Recipients become `messages` rows when it is due (0383); each message names its campaign, and
-- the counts are `group by status, skip_reason` over those rows, never stored counters.
set local lock_timeout = '5s';

create table aarogyam.campaigns (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  name text not null check (char_length(btrim(name)) between 1 and 120 and name !~ '[\r\n]'),
  audience_id uuid not null,
  template_id uuid not null,
  channel text not null check (channel in ('email', 'whatsapp')),
  -- The one allow-listed variable a campaign fills ({{offer_text}}); the email body too.
  offer_text text not null
    check (char_length(btrim(offer_text)) between 1 and 300 and offer_text !~ '[\r\n]'),
  scheduled_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  -- The audience size the owner saw (count_token) when it was scheduled.
  scheduled_count int check (scheduled_count >= 0),
  -- Fan-out: the last patient expanded (patients go in id order), when it began and ended.
  fan_out_cursor uuid,
  fan_out_started_at timestamptz,
  fan_out_done_at timestamptz,
  last_batch_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, audience_id) references aarogyam.audiences (org_id, id),
  foreign key (org_id, template_id) references aarogyam.message_templates (org_id, id),
  check (status in ('draft', 'cancelled') or scheduled_at is not null),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index campaigns_due on aarogyam.campaigns (scheduled_at) where status in ('scheduled', 'sending');
create index campaigns_audience on aarogyam.campaigns (org_id, audience_id);
create index campaigns_template on aarogyam.campaigns (org_id, template_id);
comment on table aarogyam.campaigns is 'sensitivity=internal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.campaigns', 'mutable');

insert into audit.audit_config (table_name, exclude, mask, metadata_only) values
  ('aarogyam.campaigns', '{fan_out_cursor,last_batch_at}', '{}', false);
create policy no_support on aarogyam.campaigns as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');

-- Messages name their campaign; only promotional ones can. Expand only.
alter table aarogyam.messages add column campaign_id uuid;
alter table aarogyam.messages add constraint messages_campaign_fk
  foreign key (org_id, campaign_id) references aarogyam.campaigns (org_id, id);
alter table aarogyam.messages add constraint messages_campaign_purpose
  check (campaign_id is null or purpose = 'promotional');
create index messages_campaign on aarogyam.messages (org_id, campaign_id, status, skip_reason)
  where campaign_id is not null;
-- The per-patient cap counts a patient's recent promotional messages.
create index messages_promotional on aarogyam.messages (org_id, patient_id, created_at desc)
  where purpose = 'promotional';

-- New reasons: the patient's weekly promotional cap, and a cancelled campaign.
alter table aarogyam.messages drop constraint messages_skip_reason_check;
alter table aarogyam.messages add constraint messages_skip_reason_check check (skip_reason in (
  'no_consent', 'consent_withdrawn', 'opted_out', 'no_address', 'patient_erased',
  'patient_merged', 'patient_deleted', 'patient_deceased', 'appointment_changed',
  'unsupported', 'channel_disabled', 'no_opt_in', 'template_unavailable', 'template_paused',
  'marketing_limit', 'undeliverable', 'frequency_cap', 'campaign_cancelled'));
