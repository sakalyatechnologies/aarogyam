-- Counters behind readable numbers (SC-1042, SC/26-27/000318).
set local lock_timeout = '5s';

create table aarogyam.number_sequences (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  kind text not null check (kind in ('patient', 'visit', 'invoice', 'prescription', 'receipt', 'lab_order')),
  series text not null default 'main' check (series ~ '^[a-z0-9_-]{1,32}$'),
  -- Financial year such as 26-27, computed by the API in the clinic's time zone; empty
  -- for numbers that never restart (patients).
  period text not null default '' check (period ~ '^([0-9]{2}-[0-9]{2})?$'),
  next_value bigint not null default 1 check (next_value >= 1),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, kind, series, period)
);
comment on table aarogyam.number_sequences is 'sensitivity=internal offline=server_only lifecycle=mutable';
-- Not audited: the documents it numbers carry the history.
select app.protect_clinic_table('aarogyam.number_sequences', 'mutable', audited => false);

-- Issues the next number in the caller's clinic transaction. The row lock serialises
-- concurrent callers, so numbers never repeat; a rolled-back transaction leaves a gap,
-- which is allowed. The first number of a new period needs no setup.
create function app.next_number(p_kind text, p_series text default 'main', p_period text default '')
  returns bigint
  language sql volatile set search_path = ''
  as $$
    insert into aarogyam.number_sequences as s (org_id, kind, series, period, next_value)
    values (app.tenant_id(), p_kind, p_series, p_period, 2)
    on conflict (org_id, kind, series, period) do update set next_value = s.next_value + 1
    returning s.next_value - 1
  $$;
grant execute on function app.next_number(text, text, text) to app_user;
