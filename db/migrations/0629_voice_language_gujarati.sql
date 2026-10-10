-- Recordings may be spoken in Gujarati (gu-IN). Widens the allowed languages; existing rows stay valid.
alter table aarogyam.attachments drop constraint attachments_language_check;
alter table aarogyam.attachments add constraint attachments_language_check
  check (language in ('en-IN', 'hi-IN', 'mr-IN', 'gu-IN'));
