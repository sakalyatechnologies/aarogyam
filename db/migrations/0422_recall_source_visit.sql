-- A follow-up planned when a visit closes remembers that visit.
set local lock_timeout = '5s';

alter table aarogyam.recalls add column source_encounter_id uuid;
alter table aarogyam.recalls
  add foreign key (org_id, source_encounter_id) references aarogyam.encounters (org_id, id);
create index recalls_encounter on aarogyam.recalls (org_id, source_encounter_id)
  where source_encounter_id is not null;
