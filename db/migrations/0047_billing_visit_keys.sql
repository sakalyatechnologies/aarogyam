-- Visits and procedures have merged, so the bills, prescriptions and follow-ups that name them
-- get their composite foreign keys: a bill or prescription can only name a visit of the same
-- clinic and the same patient, a bill line or follow-up only a procedure of the same clinic.
set local lock_timeout = '5s';

alter table aarogyam.invoices
  add foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id);
create index invoices_encounter_patient on aarogyam.invoices (org_id, encounter_id, patient_id)
  where encounter_id is not null;
drop index aarogyam.invoices_encounter;

alter table aarogyam.prescriptions
  add foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id);
create index prescriptions_encounter_patient on aarogyam.prescriptions (org_id, encounter_id, patient_id)
  where encounter_id is not null;
drop index aarogyam.prescriptions_encounter;

alter table aarogyam.invoice_items
  add foreign key (org_id, procedure_id) references aarogyam.procedures (org_id, id);

alter table aarogyam.recalls
  add foreign key (org_id, source_procedure_id) references aarogyam.procedures (org_id, id);
