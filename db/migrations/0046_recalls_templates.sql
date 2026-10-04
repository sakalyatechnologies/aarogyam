-- Follow-ups that fall due (cleaning in six months, review after a root canal), and print
-- layouts for prescriptions and bills.
--
-- source_procedure_id is a plain column for now: procedures arrive in a parallel branch, and a
-- follow-up migration adds its composite foreign key after it merges.
set local lock_timeout = '5s';

create table aarogyam.recalls (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  patient_id uuid not null,
  kind text not null default 'follow_up' check (kind ~ '^[a-z][a-z_]{0,31}$'),
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  due_on date not null,
  status text not null default 'due' check (status in ('due', 'notified', 'booked', 'done', 'dismissed')),
  done_at timestamptz,
  source_procedure_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  check ((status = 'done') = (done_at is not null))
);
create index recalls_due on aarogyam.recalls (org_id, due_on) where status in ('due', 'notified');
create index recalls_patient on aarogyam.recalls (org_id, patient_id, due_on);
create index recalls_procedure on aarogyam.recalls (org_id, source_procedure_id) where source_procedure_id is not null;
comment on table aarogyam.recalls is 'sensitivity=health offline=read_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.recalls', 'mutable');

-- Aarogyam's default layouts are copied into each clinic as data, so org_id is never null.
create table aarogyam.document_templates (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  kind text not null check (kind in ('prescription', 'invoice', 'receipt', 'consent', 'certificate', 'letter')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  paper text not null default 'a4' check (paper in ('a4', 'a5', 'thermal_80mm')),
  uses_letterhead boolean not null default false,
  body text not null default '' check (char_length(body) <= 20000),
  pack text check (pack ~ '^[a-z]{2,20}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id)
);
create unique index document_templates_default on aarogyam.document_templates (org_id, kind)
  where is_default and deleted_at is null;
comment on table aarogyam.document_templates is 'sensitivity=internal offline=read_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.document_templates', 'soft_delete');

alter table aarogyam.prescriptions
  add foreign key (org_id, template_id) references aarogyam.document_templates (org_id, id);
create index prescriptions_template on aarogyam.prescriptions (org_id, template_id) where template_id is not null;
