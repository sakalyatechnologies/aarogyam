-- A staff member's app language (en, hi or mr); null means the device's own language. Written by
-- PUT /me/ui-prefs. Expand only: a nullable column, no data.
set local lock_timeout = '5s';

alter table aarogyam.member_ui_prefs
  add column language text check (language in ('en', 'hi', 'mr'));
