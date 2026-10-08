-- Patient accounts for the patient app, and their links to clinic records (docs/patient-access.md,
-- section 3). An account is a person who signed in with a verified email; it holds no clinic data.
-- It sees a clinic's records only through an active link, made by a clinic-issued code or by a
-- match the clinic confirms; never automatically by phone or name.
set local lock_timeout = '5s';

-- A platform table: reached only through the definer functions in 0261, never by app_user.
create table aarogyam.patient_accounts (
  id uuid primary key default app.uuid_v7(),
  auth_uid uuid not null unique,
  email text not null check (email = lower(email) and email like '_%@_%' and char_length(email) <= 320),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table aarogyam.patient_accounts is 'sensitivity=personal offline=server_only lifecycle=mutable';
alter table aarogyam.patient_accounts enable row level security;
create trigger set_row_times before insert or update on aarogyam.patient_accounts
  for each row execute function app.set_row_times();
create trigger audit after insert or update or delete on aarogyam.patient_accounts
  for each row execute function app.audit_row();
insert into audit.audit_config (table_name, mask) values ('aarogyam.patient_accounts', '{email}');

-- An account's link to the clinic's record of that patient. `pending` waits for the clinic to
-- confirm a match the patient asked for; `active` lets the account read the record's
-- appointments, issued prescriptions, bills and shared files; `declined` and `revoked` end it.
-- Consent is recorded when the patient redeems a code or asks for the match (DPDP Act).
create table aarogyam.patient_links (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  account_id uuid not null references aarogyam.patient_accounts (id),
  status text not null check (status in ('pending', 'active', 'declined', 'revoked')),
  linked_via text not null check (linked_via in ('code', 'clinic_confirmed')),
  purpose text not null default 'care' check (purpose in ('care')),
  consented_at timestamptz not null,
  linked_at timestamptz,
  -- The member who confirmed or declined a match, or revoked the link.
  decided_by uuid,
  revoked_at timestamptz,
  revoked_by text check (revoked_by in ('patient', 'clinic')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, decided_by) references aarogyam.memberships (org_id, id),
  check (status not in ('active', 'revoked') or linked_at is not null),
  check ((status = 'revoked') = (revoked_at is not null and revoked_by is not null))
);
-- One open link per account per clinic, and one active account per patient record.
create unique index patient_links_open_per_account on aarogyam.patient_links (org_id, account_id)
  where status in ('pending', 'active');
create unique index patient_links_active_per_patient on aarogyam.patient_links (org_id, patient_id)
  where status = 'active';
create index patient_links_patient on aarogyam.patient_links (org_id, patient_id);
create index patient_links_account on aarogyam.patient_links (account_id, status);
create index patient_links_decided_by on aarogyam.patient_links (org_id, decided_by) where decided_by is not null;
comment on table aarogyam.patient_links is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.patient_links', 'mutable');

-- Link codes the clinic issues ("Invite to patient app"): shown as a QR code and emailed. Only
-- the SHA-256 of the code is kept. Single use, a week long; a new code replaces the patient's
-- unused ones.
create table aarogyam.patient_link_codes (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  replaced_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id)
);
-- Codes are redeemed on the app host, before the clinic is known: looked up by hash alone.
create index patient_link_codes_hash on aarogyam.patient_link_codes (code_hash)
  where used_at is null and replaced_at is null;
create index patient_link_codes_patient on aarogyam.patient_link_codes (org_id, patient_id);
comment on table aarogyam.patient_link_codes is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.patient_link_codes', 'mutable');
insert into audit.audit_config (table_name, mask) values ('aarogyam.patient_link_codes', '{code_hash}');

-- Files the clinic chose to share with the patient in the app. Off by default.
alter table aarogyam.attachments add column shared_with_patient boolean not null default false;

-- Patients opening their own appointments are in the access record too.
alter table audit.access_log drop constraint access_log_resource_check;
alter table audit.access_log add constraint access_log_resource_check
  check (resource in ('chart', 'visit', 'note', 'attachment', 'prescription', 'invoice', 'export', 'appointment'));
