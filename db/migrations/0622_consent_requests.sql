-- "Send consent to sign": staff ask a patient to agree to the clinic's notice from their own
-- phone. A request holds the purposes asked about, the notice they will read (named when the
-- request is made, so the patient signs the text staff saw) and the SHA-256 of a one-time
-- 256-bit token; the link goes out through the `messages` queue (kind `consent.requested`, a
-- care message, email for now) and the token is shown to the caller once. The public page on
-- the clinic's host reads the notice and signs: that records the consents (method `app`,
-- recorded under the member who asked) and closes the request. Seven days, once.
set local lock_timeout = '5s';

create table aarogyam.consent_requests (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  purposes text[] not null
    check (cardinality(purposes) between 1 and 5
           and purposes <@ array['care', 'reminders', 'promotional', 'sharing', 'research']::text[]),
  -- The notice the patient reads and signs; the label is kept as on a consent.
  notice_id uuid,
  notice_version text not null check (notice_version = btrim(notice_version) and char_length(notice_version) between 1 and 40),
  requested_by uuid not null,
  expires_at timestamptz not null,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, notice_id) references aarogyam.consent_notices (org_id, id),
  foreign key (org_id, requested_by) references aarogyam.memberships (org_id, id)
);
create unique index consent_requests_token on aarogyam.consent_requests (org_id, token_hash);
create index consent_requests_patient on aarogyam.consent_requests (org_id, patient_id, created_at desc);
create index consent_requests_notice on aarogyam.consent_requests (org_id, notice_id) where notice_id is not null;
create index consent_requests_requested_by on aarogyam.consent_requests (org_id, requested_by);
create index consent_requests_expiry on aarogyam.consent_requests (expires_at);
comment on table aarogyam.consent_requests is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.consent_requests', 'mutable');
create policy no_support on aarogyam.consent_requests as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');

-- The change history keeps who asked and when it was signed, never the token's hash.
insert into audit.audit_config (table_name, exclude, mask) values
  ('aarogyam.consent_requests', '{}', '{token_hash}');

-- Erasure (0345): a patient's requests go with them (the consents they made stay, as before).
insert into audit.erasure_steps (table_name, step_order, action, set_clause, filter, note) values
  ('aarogyam.consent_requests', 45, 'delete', null, 'patient_id = $2', 'consent-to-sign links');
