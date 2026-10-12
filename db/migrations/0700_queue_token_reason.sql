-- The reason for a visit the desk captures at a walk-in (plain text, at most 200 characters,
-- trimmed; absent when none). Additive: a new nullable column, no row changes.
-- It is clinical-ish free text: the change history masks it, and erasing the patient clears it
-- (the token itself stays, as statistics). It lives and goes with the token's retention.
set local lock_timeout = '5s';

alter table aarogyam.queue_tokens
  add column reason text,
  add constraint queue_tokens_reason_len check (reason is null or char_length(reason) between 1 and 200);

insert into audit.audit_config (table_name, mask) values ('aarogyam.queue_tokens', '{reason}')
  on conflict (table_name) do update set mask = array_append(audit.audit_config.mask, 'reason');

update audit.erasure_steps
  set action = 'update', set_clause = 'reason = null',
      note = 'the token stays for statistics; the visit reason goes'
  where table_name = 'aarogyam.queue_tokens';
