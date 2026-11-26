-- Sterilisation cycles: the clinic records each autoclave run, so the Today screen can count them
-- (BK-16). Expand only: a new table. A cycle is never edited or deleted; a wrong one is noted by
-- the next. recorded_by is the member who pressed the button.
set local lock_timeout = '5s';

create table aarogyam.sterilisation_cycles (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  run_at timestamptz not null default now(),
  recorded_by uuid not null,
  load_note text check (load_note is null or char_length(btrim(load_note)) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, recorded_by) references aarogyam.memberships (org_id, id)
);
create index sterilisation_cycles_by_run on aarogyam.sterilisation_cycles (org_id, run_at);
create index sterilisation_cycles_recorded_by on aarogyam.sterilisation_cycles (org_id, recorded_by);
comment on table aarogyam.sterilisation_cycles is 'sensitivity=internal offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.sterilisation_cycles', 'append_only');
