-- An optional Idempotency-Key on POST /expenses, as on payments: a retry with the same key and
-- the same request returns the first expense instead of recording a second one. The request
-- hash lets a key reused for a different expense be refused. Older rows have neither. Additive.
set local lock_timeout = '5s';

alter table aarogyam.expenses
  add column idempotency_key text check (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,100}$'),
  add column request_hash text check (request_hash ~ '^[0-9a-f]{64}$'),
  add constraint expenses_idempotency_hash check ((idempotency_key is null) = (request_hash is null));
create unique index expenses_idempotency on aarogyam.expenses (org_id, idempotency_key)
  where idempotency_key is not null;
