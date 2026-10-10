-- Two more places in the waiting-room journey: `called` (the doctor sent the patient in; the
-- desk is told) and `ready_to_bill` (treatment done, the desk collects). The order is
-- waiting, called, in_chair, ready_to_bill, done; a patient may leave while waiting or called.
-- Expand only: the check is widened, every existing status and move stays valid, no row
-- changes. The app's transition table (aarogyam-domain schedule.rs) says which moves are
-- allowed.
set local lock_timeout = '5s';

alter table aarogyam.queue_tokens
  drop constraint queue_tokens_status_check,
  add constraint queue_tokens_status_check
    check (status in ('waiting', 'called', 'in_chair', 'ready_to_bill', 'done', 'left')) not valid;
alter table aarogyam.queue_tokens validate constraint queue_tokens_status_check;
