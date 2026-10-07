-- A name for each patient file ("OPG", "Intraoral - upper", "X-ray", "Consent", or the clinic's own),
-- so the gallery on Patient 360 can group files and a tooth can show its pictures. Optional;
-- the tooth column already exists.
set local lock_timeout = '5s';

alter table aarogyam.attachments
  add column label text check (label = btrim(label) and char_length(label) between 1 and 60);
create index attachments_tooth on aarogyam.attachments (org_id, patient_id, tooth)
  where tooth is not null and deleted_at is null;
