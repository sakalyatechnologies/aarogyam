-- The waiting-room queue: a token number per branch per clinic day, issued on arrival or to a
-- walk-in. Numbers come from number_sequences (kind queue_token, series = the branch id in hex,
-- period = the clinic's local date), so they restart each day without any setup.
set local lock_timeout = '5s';

alter table aarogyam.number_sequences drop constraint number_sequences_kind_check;
alter table aarogyam.number_sequences add constraint number_sequences_kind_check
  check (kind in ('patient', 'visit', 'invoice', 'prescription', 'receipt', 'lab_order', 'queue_token'));
alter table aarogyam.number_sequences drop constraint number_sequences_period_check;
-- A financial year (26-27), a local date (2026-10-04), or empty for numbers that never restart.
alter table aarogyam.number_sequences add constraint number_sequences_period_check
  check (period ~ '^([0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{2}-[0-9]{2})?$');

-- Reserves p_count consecutive numbers and returns the first, for imports that number many
-- records in one statement. Same locking and gap rules as app.next_number.
create function app.reserve_numbers(p_kind text, p_count int, p_series text default 'main', p_period text default '')
  returns bigint
  language sql volatile set search_path = ''
  as $$
    insert into aarogyam.number_sequences as s (org_id, kind, series, period, next_value)
    values (app.tenant_id(), p_kind, p_series, p_period, 1 + greatest(p_count, 1))
    on conflict (org_id, kind, series, period) do update set next_value = s.next_value + greatest(p_count, 1)
    returning s.next_value - greatest(p_count, 1)
  $$;
revoke execute on function app.reserve_numbers(text, int, text, text) from public;
grant execute on function app.reserve_numbers(text, int, text, text) to app_user;

create table aarogyam.queue_tokens (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  branch_id uuid not null,
  -- The clinic's local date the token belongs to.
  day date not null,
  token_number int not null check (token_number between 1 and 9999),
  patient_id uuid not null,
  -- Null for a walk-in without an appointment.
  appointment_id uuid,
  practitioner_id uuid,
  status text not null default 'waiting' check (status in ('waiting', 'in_chair', 'done', 'left')),
  issued_at timestamptz not null default now(),
  called_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, branch_id) references aarogyam.branches (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, appointment_id) references aarogyam.appointments (org_id, id),
  foreign key (org_id, practitioner_id) references aarogyam.practitioners (org_id, id),
  check (status = 'waiting' or called_at is not null or status = 'left'),
  check (status not in ('done', 'left') or done_at is not null)
);
create unique index queue_tokens_number on aarogyam.queue_tokens (org_id, branch_id, day, token_number);
-- One token per appointment.
create unique index queue_tokens_appointment on aarogyam.queue_tokens (org_id, appointment_id)
  where appointment_id is not null;
create index queue_tokens_day_status on aarogyam.queue_tokens (org_id, day, status);
create index queue_tokens_patient on aarogyam.queue_tokens (org_id, patient_id);
create index queue_tokens_practitioner on aarogyam.queue_tokens (org_id, practitioner_id)
  where practitioner_id is not null;
comment on table aarogyam.queue_tokens is 'sensitivity=personal offline=read_write lifecycle=mutable';
select app.protect_clinic_table('aarogyam.queue_tokens', 'mutable');
