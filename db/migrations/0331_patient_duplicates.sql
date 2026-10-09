-- Possible duplicate patients for the front desk to resolve. An online booking matches a
-- clinic's patient only by verified email; when the email doesn't match but the phone does, the
-- booking goes to a new self-registered record and a row here names the existing patient it
-- may duplicate. The desk merges the self-registered record into the existing one
-- (POST /patients/{id}/merge) or dismisses the flag. Never merged automatically.
set local lock_timeout = '5s';

create table aarogyam.patient_duplicates (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  -- The self-registered record.
  patient_id uuid not null,
  -- The existing patient it may be.
  candidate_id uuid not null,
  reason text not null default 'phone' check (reason in ('phone')),
  status text not null default 'open' check (status in ('open', 'merged', 'dismissed')),
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, patient_id, candidate_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, candidate_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, resolved_by) references aarogyam.memberships (org_id, id),
  check (patient_id <> candidate_id),
  check ((status = 'open') = (resolved_at is null))
);
create index patient_duplicates_open on aarogyam.patient_duplicates (org_id, created_at desc)
  where status = 'open';
create index patient_duplicates_candidate on aarogyam.patient_duplicates (org_id, candidate_id);
create index patient_duplicates_resolved_by on aarogyam.patient_duplicates (org_id, resolved_by)
  where resolved_by is not null;
comment on table aarogyam.patient_duplicates is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.patient_duplicates', 'mutable');
