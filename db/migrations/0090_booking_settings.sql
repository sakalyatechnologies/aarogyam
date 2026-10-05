-- Online booking settings: slot length, buffer, whether the front desk confirms, how far ahead
-- and how late patients may book. One object per clinic; the API fills defaults for any key
-- that is missing (15-minute slots, no buffer, front desk confirms, 30 days, one hour's notice).
set local lock_timeout = '5s';

alter table aarogyam.org_settings
  add column booking jsonb not null default '{}' check (jsonb_typeof(booking) = 'object');
