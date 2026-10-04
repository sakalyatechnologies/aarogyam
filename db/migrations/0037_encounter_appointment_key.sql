-- A visit started from an appointment must point at an appointment of the same clinic.
-- Added once M3 (appointments) and M4 (visits) were both merged; M4 created the column
-- without a key because the two were built in parallel.
set local lock_timeout = '5s';

alter table aarogyam.encounters
  add constraint encounters_appointment_fk
  foreign key (org_id, appointment_id) references aarogyam.appointments (org_id, id);
