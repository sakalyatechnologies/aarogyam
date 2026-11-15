-- How a payment to a lab was made (docs/decisions.md, "Labs"). The set is the one patient
-- payments use (0042: cash, upi, card, bank), so the clinic reads one vocabulary. Expand only:
-- nullable, so payments recorded before it, and ones recorded without a method, stay as they
-- are. Expenses carry no method, so nothing is copied there.
set local lock_timeout = '5s';

alter table aarogyam.lab_payments
  add column method text check (method in ('cash', 'upi', 'card', 'bank'));
comment on column aarogyam.lab_payments.method is 'How it was paid: cash, upi, card or bank; null when not recorded.';
