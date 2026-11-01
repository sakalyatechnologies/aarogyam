-- A task occurrence can carry a proof photo (PNG or JPEG kept in clinic file storage, as the
-- staff avatar is), read only through the authenticated API route. Tasks are not patient-bound,
-- so this is not a patient attachment and holds no patient data by design. Expand only.
set local lock_timeout = '5s';

alter table aarogyam.task_occurrences
  add column proof_file_id uuid,
  add column proof_mime text check (proof_mime in ('image/png', 'image/jpeg')),
  add constraint task_occurrences_proof_both check ((proof_file_id is null) = (proof_mime is null));
