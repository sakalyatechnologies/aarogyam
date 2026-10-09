-- Clinic-authored privacy notice text, with versions (DPDP). Until now a consent recorded only
-- a free label for the notice shown (`patient_consents.notice_version`, such as 'v1 2026-10').
-- Now a clinic publishes its notice text here; each publication is a new, numbered version and
-- is never edited, so a consent can point at the exact text the patient was shown.
--
-- Expand, then contract: `patient_consents.notice_id` is added and filled for new consents,
-- while `notice_version` stays required and keeps the label (the notice's label when there is
-- a notice), so older readers and rows recorded before this release keep working. A later
-- release may make the label optional once every reader uses `notice_id`.
set local lock_timeout = '5s';

create table aarogyam.consent_notices (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  -- 1 for the clinic's first notice, then 2, 3, ...
  version int not null check (version > 0),
  label text not null check (label = btrim(label) and char_length(label) between 1 and 40),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  published_at timestamptz not null default now(),
  published_by uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, version),
  foreign key (org_id, published_by) references aarogyam.memberships (org_id, id)
);
create index consent_notices_published_by on aarogyam.consent_notices (org_id, published_by);
comment on table aarogyam.consent_notices is 'sensitivity=internal offline=read_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.consent_notices', 'append_only');

alter table aarogyam.patient_consents
  add column notice_id uuid,
  add constraint patient_consents_notice_fk
    foreign key (org_id, notice_id) references aarogyam.consent_notices (org_id, id);
create index patient_consents_notice on aarogyam.patient_consents (org_id, notice_id)
  where notice_id is not null;
