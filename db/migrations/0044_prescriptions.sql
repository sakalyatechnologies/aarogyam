-- Prescriptions. A draft is edited freely; issuing runs the allergy check, assigns the number,
-- snapshots what the paper shows (letterhead, doctor, patient, footer) and freezes it. A
-- correction cancels it with a reason and starts a new draft that supersedes it. The QR code
-- on the paper carries a random verify token that opens only whether the prescription is
-- valid, when it was issued and by which clinic: no patient data. It is kept in clear (not
-- hashed) because every reprint must carry the same QR.
--
-- encounter_id is a plain column for now: visits arrive in a parallel branch, and a follow-up
-- migration adds the composite foreign key (org_id, encounter_id, patient_id) after it merges.
set local lock_timeout = '5s';

create table aarogyam.prescriptions (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  number text check (number ~ '^RX-[0-9]{1,12}$'),
  patient_id uuid not null,
  encounter_id uuid,
  diagnosis_text text check (char_length(diagnosis_text) <= 500),
  advice text check (char_length(advice) <= 2000),
  follow_up_on date,
  language text not null default 'en-IN' check (language ~ '^[a-z]{2}-[A-Z]{2}$'),
  status text not null default 'draft' check (status in ('draft', 'issued', 'cancelled')),
  issued_at timestamptz,
  issued_by uuid,
  -- Why the doctor issued despite the allergy alerts, when there were any.
  override_reason text check (char_length(btrim(override_reason)) between 3 and 500),
  verify_token text check (verify_token ~ '^[A-Za-z0-9_-]{43}$'),
  -- Printed facts captured at issue.
  letterhead jsonb check (jsonb_typeof(letterhead) = 'object'),
  doctor jsonb check (jsonb_typeof(doctor) = 'object'),
  recipient jsonb check (jsonb_typeof(recipient) = 'object'),
  footer text check (char_length(footer) <= 500),
  cancel_reason text check (char_length(btrim(cancel_reason)) between 3 and 500),
  cancelled_at timestamptz,
  cancelled_by uuid,
  supersedes_id uuid,
  template_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, id, patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, supersedes_id, patient_id) references aarogyam.prescriptions (org_id, id, patient_id),
  foreign key (org_id, issued_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, cancelled_by) references aarogyam.memberships (org_id, id),
  check ((number is null) = (issued_at is null)),
  check (status = 'draft' or (number is not null and verify_token is not null and issued_by is not null
                              and letterhead is not null and doctor is not null and recipient is not null)),
  check ((status = 'cancelled') = (cancel_reason is not null and cancelled_at is not null))
);
create unique index prescriptions_number on aarogyam.prescriptions (org_id, number) where number is not null;
create unique index prescriptions_verify on aarogyam.prescriptions (org_id, verify_token)
  where verify_token is not null;
-- A prescription is replaced at most once.
create unique index prescriptions_supersedes on aarogyam.prescriptions (org_id, supersedes_id, patient_id)
  where supersedes_id is not null;
create index prescriptions_patient on aarogyam.prescriptions (org_id, patient_id, created_at desc);
create index prescriptions_issued_by on aarogyam.prescriptions (org_id, issued_by) where issued_by is not null;
create index prescriptions_cancelled_by on aarogyam.prescriptions (org_id, cancelled_by) where cancelled_by is not null;
create index prescriptions_encounter on aarogyam.prescriptions (org_id, encounter_id) where encounter_id is not null;
comment on table aarogyam.prescriptions is 'sensitivity=health offline=read_write lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.prescriptions', 'finalizable');
create trigger freeze_when_final before update on aarogyam.prescriptions
  for each row execute function app.freeze_when_final('draft', 'cancelled', 'cancel_reason', 'cancelled_at', 'cancelled_by');
insert into audit.audit_config (table_name, mask) values ('aarogyam.prescriptions', '{verify_token}');

create table aarogyam.prescription_items (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  prescription_id uuid not null,
  line_no smallint not null check (line_no between 1 and 50),
  drug_id uuid references aarogyam.drug_catalog (id),
  -- As printed: the generic name, shown in capitals.
  drug_name text not null check (char_length(btrim(drug_name)) between 1 and 200),
  strength text check (char_length(strength) <= 60),
  form text check (char_length(form) <= 30),
  dose text not null check (char_length(btrim(dose)) between 1 and 60),
  frequency text not null check (char_length(btrim(frequency)) between 1 and 40),
  timing text check (timing in ('before_food', 'after_food', 'empty_stomach', 'bedtime', 'sos', 'as_directed')),
  duration_days smallint check (duration_days between 1 and 365),
  instructions text check (char_length(instructions) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, prescription_id, line_no),
  foreign key (org_id, prescription_id) references aarogyam.prescriptions (org_id, id)
);
create index prescription_items_drug on aarogyam.prescription_items (drug_id) where drug_id is not null;
comment on table aarogyam.prescription_items is 'sensitivity=health offline=read_write lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.prescription_items', 'finalizable');
create trigger freeze_with_parent before insert or update or delete on aarogyam.prescription_items
  for each row execute function app.freeze_with_parent('aarogyam.prescriptions', 'prescription_id');

create function app.clear_draft_prescription_lines(p_prescription_id uuid)
  returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
  begin
    delete from aarogyam.prescription_items i
    using aarogyam.prescriptions p
    where i.org_id = app.tenant_id() and i.prescription_id = p_prescription_id
      and p.org_id = i.org_id and p.id = i.prescription_id and p.status = 'draft';
  end
  $$;
grant execute on function app.clear_draft_prescription_lines(uuid) to app_user;

-- Safety warnings raised when the prescription was issued, and the doctor's override. Written
-- once, at issue, so they name the final lines.
create table aarogyam.prescription_alerts (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  prescription_id uuid not null,
  prescription_item_id uuid,
  kind text not null check (kind in ('allergy', 'interaction', 'contraindication', 'pregnancy',
                                     'lactation', 'pediatric_dose', 'duplicate', 'precaution')),
  severity text not null check (severity in ('info', 'caution', 'serious')),
  message text not null check (char_length(message) between 1 and 300),
  source text not null check (source in ('allergy_record', 'drug_database', 'ai')),
  action text not null check (action in ('accepted_change', 'overridden', 'dismissed')),
  override_reason text check (char_length(btrim(override_reason)) between 3 and 500),
  acted_by uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, prescription_id) references aarogyam.prescriptions (org_id, id),
  foreign key (org_id, prescription_item_id) references aarogyam.prescription_items (org_id, id),
  foreign key (org_id, acted_by) references aarogyam.memberships (org_id, id),
  check (action <> 'overridden' or override_reason is not null)
);
create index prescription_alerts_prescription on aarogyam.prescription_alerts (org_id, prescription_id);
create index prescription_alerts_item on aarogyam.prescription_alerts (org_id, prescription_item_id)
  where prescription_item_id is not null;
create index prescription_alerts_acted_by on aarogyam.prescription_alerts (org_id, acted_by);
comment on table aarogyam.prescription_alerts is 'sensitivity=health offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.prescription_alerts', 'append_only');
