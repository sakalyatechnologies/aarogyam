-- Qualifications ("BDS, MDS Orthodontics") printed under a doctor's name on the clinic
-- letterhead, next to the registration number the table already holds.
set local lock_timeout = '5s';

alter table aarogyam.practitioners
  add column qualifications text check (char_length(btrim(qualifications)) between 1 and 160);
