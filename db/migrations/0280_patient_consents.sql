-- Consent and notice records (DPDP Act 2023): the clinic is the data fiduciary, so it must be
-- able to show that a patient was given its privacy notice and agreed to each purpose, which
-- notice version they saw, when, how (paper, verbal or app) and who recorded it, and when the
-- patient later withdrew. One row per consent given; a withdrawal fills the withdrawn_* columns
-- once and then the row is final (app.freeze_when_final), so the history stays truthful.
-- At most one active consent per patient and purpose.
set local lock_timeout = '5s';

create table aarogyam.patient_consents (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  purpose text not null check (purpose in ('care', 'reminders', 'promotional', 'sharing', 'research')),
  -- The clinic's own label for the notice text the patient was shown, such as 'v1 2026-10'.
  notice_version text not null check (notice_version = btrim(notice_version) and char_length(notice_version) between 1 and 40),
  given_at timestamptz not null default now(),
  method text not null check (method in ('paper', 'verbal', 'app')),
  recorded_by uuid not null,
  status text not null default 'given' check (status in ('given', 'withdrawn')),
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdrawn_method text check (withdrawn_method in ('paper', 'verbal', 'app')),
  note text check (note is null or char_length(note) <= 500),
  withdrawal_note text check (withdrawal_note is null or char_length(withdrawal_note) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, recorded_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, withdrawn_by) references aarogyam.memberships (org_id, id),
  check ((status = 'withdrawn') = (withdrawn_at is not null and withdrawn_by is not null and withdrawn_method is not null))
);
create unique index patient_consents_one_active on aarogyam.patient_consents (org_id, patient_id, purpose)
  where status = 'given';
create index patient_consents_patient on aarogyam.patient_consents (org_id, patient_id, given_at desc);
create index patient_consents_recorded_by on aarogyam.patient_consents (org_id, recorded_by);
create index patient_consents_withdrawn_by on aarogyam.patient_consents (org_id, withdrawn_by)
  where withdrawn_by is not null;
comment on table aarogyam.patient_consents is 'sensitivity=personal offline=server_only lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.patient_consents', 'finalizable');
create trigger freeze_when_final before update on aarogyam.patient_consents
  for each row execute function app.freeze_when_final('', 'withdrawn', 'withdrawn_at', 'withdrawn_by', 'withdrawn_method', 'withdrawal_note');
