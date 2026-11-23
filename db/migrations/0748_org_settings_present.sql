-- The clinic's Show patient choices (docs/plans/present-studio-design.md section 12.3, slice 2b):
-- whether prices may be shown behind the doctor's Prices tap (show_prices) and which price-list
-- code each option part maps to (price_map). Written only by PUT /settings/present, which checks
-- the keys and codes. No patient data. Expand only: a new column with a default.
set local lock_timeout = '5s';

alter table aarogyam.org_settings
  add column present jsonb not null default '{}' check (jsonb_typeof(present) = 'object');
grant update (present) on aarogyam.org_settings to app_user;
