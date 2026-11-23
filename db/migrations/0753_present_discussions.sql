-- "What we discussed" in Show patient (docs/plans/present-studio-design.md, sections 12.4, F6).
-- One row per visit, tooth (null for an example-arch topic) and situation: the options the
-- doctor and patient went through, with the one the patient prefers. Append-only: a new save
-- supersedes the current row, a wrong row is marked entered in error with a reason; nothing is
-- deleted. It reaches the patient only with the doctor's tick (send_to_patient, slice 2f).
-- from_paise is frozen when the row is saved to be sent with prices on. Kept on erasure like
-- specialty_records; only its change history is scrubbed. Expand only: a new table.
set local lock_timeout = '5s';

create table aarogyam.present_discussions (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  encounter_id uuid not null,
  tooth smallint check (tooth is null
    or (tooth / 10 between 1 and 4 and tooth % 10 between 1 and 8)
    or (tooth / 10 between 5 and 8 and tooth % 10 between 1 and 5)),
  situation text not null check (situation ~ '^[a-z_]{2,40}$'),
  -- [{key, material?, preferred, from_paise?}]; keys are validated in the domain.
  options jsonb not null
    check (jsonb_typeof(options) = 'array' and pg_column_size(options) <= 4096),
  send_to_patient boolean not null default false,
  status text not null default 'current' check (status in ('current', 'superseded', 'entered_in_error')),
  supersedes_id uuid,
  error_reason text check (char_length(error_reason) between 3 and 500),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, id, patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id),
  foreign key (org_id, supersedes_id, patient_id) references aarogyam.present_discussions (org_id, id, patient_id),
  check (supersedes_id is distinct from id),
  check ((status = 'entered_in_error') = (error_reason is not null))
);
create unique index present_discussions_one_current on aarogyam.present_discussions
  (org_id, encounter_id, coalesce(tooth, 0), situation) where status = 'current';
create unique index present_discussions_supersedes on aarogyam.present_discussions
  (org_id, supersedes_id, patient_id) where supersedes_id is not null;
create index present_discussions_patient on aarogyam.present_discussions (org_id, patient_id);
create index present_discussions_encounter on aarogyam.present_discussions (org_id, encounter_id, patient_id);
comment on table aarogyam.present_discussions is 'sensitivity=health offline=server_only lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.present_discussions', 'finalizable');
create trigger freeze_when before update on aarogyam.present_discussions
  for each row execute function app.freeze_when(
    'status', 'current,superseded,entered_in_error', 'current>superseded,current>entered_in_error', 'error_reason');

-- Erasure (0345): kept, like specialty_records; only the change history is scrubbed.
insert into audit.erasure_steps (table_name, step_order, action, set_clause, note) values
  ('aarogyam.present_discussions', 100, 'keep', null, 'options discussed in Show patient (F6)');
