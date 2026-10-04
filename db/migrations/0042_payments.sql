-- Money received, and which bills it pays. The amount comes from the request but each
-- allocation is checked against the bill's balance on the server; a client retry carries the
-- same Idempotency-Key and finds the first payment instead of charging twice. A payment is
-- never deleted: a mistake is voided with a reason, and its allocations stop counting.
set local lock_timeout = '5s';

create table aarogyam.payments (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  -- Receipt number: RC/26-27/000042, per financial year in clinic time.
  number text not null check (number ~ '^RC/[0-9]{2}-[0-9]{2}/[0-9]{6}$'),
  patient_id uuid not null,
  received_at timestamptz not null,
  amount_paise bigint not null check (amount_paise > 0),
  method text not null check (method in ('cash', 'upi', 'card', 'bank')),
  reference text check (char_length(btrim(reference)) between 1 and 64),
  received_by uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,100}$'),
  -- SHA-256 of the request, so a reused key with a different request is refused.
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'received' check (status in ('received', 'void')),
  void_reason text check (char_length(btrim(void_reason)) between 3 and 500),
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, id, patient_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, received_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, voided_by) references aarogyam.memberships (org_id, id),
  check ((status = 'void') = (void_reason is not null and voided_at is not null))
);
create unique index payments_number on aarogyam.payments (org_id, number);
create unique index payments_idempotency on aarogyam.payments (org_id, idempotency_key);
create index payments_received on aarogyam.payments (org_id, received_at);
create index payments_patient on aarogyam.payments (org_id, patient_id, received_at desc);
create index payments_received_by on aarogyam.payments (org_id, received_by);
create index payments_voided_by on aarogyam.payments (org_id, voided_by) where voided_by is not null;
comment on table aarogyam.payments is 'sensitivity=personal offline=server_only lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.payments', 'finalizable');
create trigger freeze_when_final before update on aarogyam.payments
  for each row execute function app.freeze_when_final('', 'void', 'void_reason', 'voided_at', 'voided_by');
insert into audit.audit_config (table_name, exclude) values ('aarogyam.payments', '{request_hash}');

create table aarogyam.payment_allocations (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  payment_id uuid not null,
  invoice_id uuid not null,
  -- The payment's and the bill's patient, which the two keys below make agree.
  patient_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, payment_id, invoice_id),
  foreign key (org_id, payment_id, patient_id) references aarogyam.payments (org_id, id, patient_id),
  foreign key (org_id, invoice_id, patient_id) references aarogyam.invoices (org_id, id, patient_id)
);
create index payment_allocations_invoice on aarogyam.payment_allocations (org_id, invoice_id, patient_id);
create index payment_allocations_payment on aarogyam.payment_allocations (org_id, payment_id, patient_id);
comment on table aarogyam.payment_allocations is 'sensitivity=personal offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.payment_allocations', 'append_only');

-- The backstop for the API's own checks: an allocation goes only to an issued bill, and never
-- takes the bill past its total or the payment past its amount. The API locks the bill first,
-- so concurrent payments are checked one after the other.
create function app.check_payment_allocation() returns trigger
  language plpgsql set search_path = ''
  as $$
  declare
    v_status text;
    v_total bigint;
    v_paid bigint;
    v_amount bigint;
    v_allocated bigint;
  begin
    select status, total_paise into v_status, v_total
      from aarogyam.invoices where org_id = new.org_id and id = new.invoice_id;
    if v_status is distinct from 'issued' then
      raise exception 'only issued bills take payments' using errcode = 'check_violation';
    end if;
    select coalesce(sum(a.amount_paise), 0) into v_paid
      from aarogyam.payment_allocations a
      join aarogyam.payments p on p.org_id = a.org_id and p.id = a.payment_id
      where a.org_id = new.org_id and a.invoice_id = new.invoice_id and p.status = 'received';
    if v_paid + new.amount_paise > v_total then
      raise exception 'allocation exceeds the bill''s balance' using errcode = 'check_violation';
    end if;
    select amount_paise into v_amount
      from aarogyam.payments where org_id = new.org_id and id = new.payment_id;
    select coalesce(sum(amount_paise), 0) into v_allocated
      from aarogyam.payment_allocations where org_id = new.org_id and payment_id = new.payment_id;
    if v_allocated + new.amount_paise > v_amount then
      raise exception 'allocations exceed the payment' using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;
create trigger check_allocation before insert on aarogyam.payment_allocations
  for each row execute function app.check_payment_allocation();
