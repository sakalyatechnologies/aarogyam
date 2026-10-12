-- What the patient list shows beside each name besides the summary (0141): an allergy alert,
-- whether consent to care is still to be recorded, and whether the patient has a photo. One
-- row, read in the same statement as the patient (`cross join lateral`), so the list stays one
-- trip. Runs as the caller, so row-level security limits it to the current clinic.
--
-- allergy_alert: an allergy is active, whoever recorded it (a patient-reported one counts
--   until a clinician rules it out; a missed alert costs more than a false one).
-- consent_pending: no active consent to care is on record (never given, or withdrawn).
set local lock_timeout = '5s';

create function app.patient_flags(p_patient_id uuid)
  returns table (allergy_alert boolean, consent_pending boolean, has_photo boolean)
  language sql stable
  as $$
    select exists (select 1 from aarogyam.allergies a
                   where a.patient_id = p_patient_id and a.status = 'active'),
           not exists (select 1 from aarogyam.patient_consents c
                       where c.patient_id = p_patient_id and c.purpose = 'care' and c.status = 'given'),
           exists (select 1 from aarogyam.patient_photos ph where ph.patient_id = p_patient_id)
  $$;
grant execute on function app.patient_flags(uuid) to app_user;
