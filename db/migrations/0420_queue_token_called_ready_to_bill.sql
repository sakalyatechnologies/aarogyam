-- Queue states for the visit flow (docs/flows/clinic-visit-flow.md): `called` (the doctor has
-- called the patient in; the front desk sends them) and `ready_to_bill` (the chair work is done;
-- the front desk collects payment). Expand only: the check admits the new values, nothing
-- else changes, and the old moves (waiting to in_chair or done, in_chair to done) stay valid.
set local lock_timeout = '5s';

alter table aarogyam.queue_tokens
  drop constraint queue_tokens_status_check,
  add constraint queue_tokens_status_check
    check (status in ('waiting', 'called', 'in_chair', 'ready_to_bill', 'done', 'left')) not valid;
alter table aarogyam.queue_tokens validate constraint queue_tokens_status_check;
