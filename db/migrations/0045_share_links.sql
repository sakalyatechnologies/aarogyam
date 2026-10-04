-- Links a clinic sends a patient (from its own WhatsApp) to open a prescription. The link
-- holds a 256-bit token; the paper prescription carries a six-digit PIN. Only hashes are
-- stored. Five wrong PINs lock the link; it expires after seven days. Every open is written
-- to the access record with purpose patient_self and the link's id.
set local lock_timeout = '5s';

create table aarogyam.share_links (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the token and the PIN together, so the PIN can't be guessed offline without
  -- the link.
  pin_hash text not null check (pin_hash ~ '^[0-9a-f]{64}$'),
  resource text not null check (resource in ('prescription', 'invoice', 'report', 'upload_request')),
  prescription_id uuid,
  invoice_id uuid,
  patient_id uuid not null,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'sms', 'email', 'print')),
  failed_attempts int not null default 0 check (failed_attempts between 0 and 100),
  locked_at timestamptz,
  expires_at timestamptz not null,
  opened_at timestamptz,
  open_count int not null default 0 check (open_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, prescription_id, patient_id) references aarogyam.prescriptions (org_id, id, patient_id),
  foreign key (org_id, invoice_id, patient_id) references aarogyam.invoices (org_id, id, patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  check ((resource = 'prescription') = (prescription_id is not null)),
  check ((resource = 'invoice') = (invoice_id is not null))
);
create unique index share_links_token on aarogyam.share_links (org_id, token_hash);
create index share_links_prescription on aarogyam.share_links (org_id, prescription_id, patient_id)
  where prescription_id is not null;
create index share_links_invoice on aarogyam.share_links (org_id, invoice_id, patient_id)
  where invoice_id is not null;
create index share_links_patient on aarogyam.share_links (org_id, patient_id);
comment on table aarogyam.share_links is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.share_links', 'mutable');
insert into audit.audit_config (table_name, exclude, mask) values
  ('aarogyam.share_links', '{open_count,opened_at}', '{token_hash,pin_hash}');
