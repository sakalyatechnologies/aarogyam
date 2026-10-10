-- A client_id on the creates a phone or portal may repeat after a lost answer: the dental chart
-- (the first entry of a batch carries it), procedures and prescription drafts. A retry with the
-- same client_id and the same request returns the first record instead of making a second one;
-- the request hash lets a client_id reused for a different request be refused. Unique per clinic.
-- Older rows have neither. Additive: nothing existing changes, and the freeze guards are
-- untouched because a row is only ever written once with them.
set local lock_timeout = '5s';

alter table aarogyam.specialty_records
  add column client_id uuid,
  add column request_hash text check (request_hash ~ '^[0-9a-f]{64}$'),
  add constraint specialty_records_client_hash check ((client_id is null) = (request_hash is null));
create unique index specialty_records_client_id on aarogyam.specialty_records (org_id, client_id)
  where client_id is not null;

alter table aarogyam.procedures
  add column client_id uuid,
  add column request_hash text check (request_hash ~ '^[0-9a-f]{64}$'),
  add constraint procedures_client_hash check ((client_id is null) = (request_hash is null));
create unique index procedures_client_id on aarogyam.procedures (org_id, client_id)
  where client_id is not null;

alter table aarogyam.prescriptions
  add column client_id uuid,
  add column request_hash text check (request_hash ~ '^[0-9a-f]{64}$'),
  add constraint prescriptions_client_hash check ((client_id is null) = (request_hash is null));
create unique index prescriptions_client_id on aarogyam.prescriptions (org_id, client_id)
  where client_id is not null;
