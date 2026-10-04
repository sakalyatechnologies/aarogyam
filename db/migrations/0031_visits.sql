-- Visits (encounters), their notes, and addenda to signed notes.
set local lock_timeout = '5s';

create table aarogyam.encounters (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  number text not null check (number ~ '^V-[0-9]{1,12}$'),
  patient_id uuid not null,
  -- The member responsible for the visit (a doctor's practitioner record hangs off the same
  -- membership).
  clinician_id uuid not null,
  branch_id uuid not null,
  -- The appointment the visit was started from. The foreign key to appointments is added by a
  -- later migration, once the appointments table exists.
  appointment_id uuid,
  status text not null default 'open' check (status in ('open', 'closed')),
  chief_complaint text check (char_length(chief_complaint) between 1 and 1000),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  -- Lets every child row prove it belongs to the same patient as its visit.
  unique (org_id, id, patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, clinician_id) references aarogyam.memberships (org_id, id),
  foreign key (org_id, branch_id) references aarogyam.branches (org_id, id),
  check ((status = 'closed') = (ended_at is not null)),
  check (ended_at is null or ended_at >= started_at)
);
create unique index encounters_number on aarogyam.encounters (org_id, number);
create index encounters_patient on aarogyam.encounters (org_id, patient_id, started_at desc);
create index encounters_clinician on aarogyam.encounters (org_id, clinician_id, started_at desc);
create index encounters_branch on aarogyam.encounters (org_id, branch_id, started_at desc);
-- One visit per appointment.
create unique index encounters_appointment on aarogyam.encounters (org_id, appointment_id)
  where appointment_id is not null;
comment on table aarogyam.encounters is 'sensitivity=health offline=read_write lifecycle=mutable';
select app.protect_clinic_table('aarogyam.encounters', 'mutable');

create table aarogyam.clinical_notes (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  encounter_id uuid not null,
  patient_id uuid not null,
  author_id uuid not null,
  kind text not null default 'soap' check (kind in ('soap', 'progress', 'procedure', 'intake', 'front_desk')),
  -- Sections: subjective, objective, assessment, plan.
  body jsonb not null default '{}' check (jsonb_typeof(body) = 'object' and pg_column_size(body) <= 65536),
  source text not null default 'typed' check (source in ('typed', 'voice', 'ai_draft')),
  status text not null default 'draft' check (status in ('draft', 'signed', 'conflict', 'entered_in_error')),
  signed_at timestamptz,
  signed_by uuid,
  conflicts_with_id uuid,
  error_reason text check (char_length(error_reason) between 3 and 500),
  error_at timestamptz,
  error_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id),
  foreign key (org_id, author_id) references aarogyam.memberships (org_id, id),
  foreign key (org_id, signed_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, error_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, conflicts_with_id) references aarogyam.clinical_notes (org_id, id),
  check ((signed_at is null) = (signed_by is null)),
  check (status <> 'signed' or signed_at is not null),
  check (status <> 'conflict' or conflicts_with_id is not null),
  check ((status = 'entered_in_error') = (error_reason is not null and error_at is not null and error_by is not null))
);
create index clinical_notes_encounter on aarogyam.clinical_notes (org_id, encounter_id, patient_id);
create index clinical_notes_patient on aarogyam.clinical_notes (org_id, patient_id, created_at desc);
create index clinical_notes_author on aarogyam.clinical_notes (org_id, author_id);
create index clinical_notes_signed_by on aarogyam.clinical_notes (org_id, signed_by) where signed_by is not null;
create index clinical_notes_error_by on aarogyam.clinical_notes (org_id, error_by) where error_by is not null;
create index clinical_notes_conflicts_with on aarogyam.clinical_notes (org_id, conflicts_with_id)
  where conflicts_with_id is not null;
comment on table aarogyam.clinical_notes is 'sensitivity=health offline=read_write lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.clinical_notes', 'finalizable');
create trigger freeze_when_final before update on aarogyam.clinical_notes
  for each row execute function app.freeze_when(
    'status', 'signed,conflict,entered_in_error',
    'signed>entered_in_error,conflict>entered_in_error', 'error_reason,error_at,error_by');

create table aarogyam.note_addenda (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  note_id uuid not null,
  author_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, note_id) references aarogyam.clinical_notes (org_id, id),
  foreign key (org_id, author_id) references aarogyam.memberships (org_id, id)
);
create index note_addenda_note on aarogyam.note_addenda (org_id, note_id, created_at);
create index note_addenda_author on aarogyam.note_addenda (org_id, author_id);
comment on table aarogyam.note_addenda is 'sensitivity=health offline=read_write lifecycle=append_only';
select app.protect_clinic_table('aarogyam.note_addenda', 'append_only');
