-- What erasure needs first (docs/decisions.md, "Retention schedule and anonymisation design"):
-- a legal hold that stops a patient's erasure, an `erased` patient status with its time, and a
-- per-clinic retention period for patient records that may only be longer than the default.
set local lock_timeout = '5s';

alter table aarogyam.patients
  add column legal_hold boolean not null default false,
  add column legal_hold_reason text check (char_length(legal_hold_reason) between 3 and 300
                                           and legal_hold_reason = btrim(legal_hold_reason)),
  add column legal_hold_at timestamptz,
  add column erased_at timestamptz,
  add constraint patients_legal_hold
    check (legal_hold = (legal_hold_reason is not null and legal_hold_at is not null)),
  drop constraint patients_status_check,
  add constraint patients_status_check
    check (status in ('active', 'inactive', 'deceased', 'merged', 'erased')),
  add constraint patients_erased check ((status = 'erased') = (erased_at is not null));
create index patients_legal_hold on aarogyam.patients (org_id) where legal_hold;

-- A legal hold is not an edit of the patient's details: it must not make a front desk edit
-- (If-Match) stale.
drop trigger row_version on aarogyam.patients;
create trigger row_version before update on aarogyam.patients
  for each row execute function app.bump_row_version(
    'last_visit_at', 'search_name', 'allergies_reviewed', 'allergies_reviewed_at',
    'legal_hold', 'legal_hold_reason', 'legal_hold_at');

-- Years to keep patient records after their last activity; null keeps the default (7). A clinic
-- may keep longer, never shorter.
alter table aarogyam.org_settings
  add column patient_retention_years smallint check (patient_retention_years between 7 and 50);
