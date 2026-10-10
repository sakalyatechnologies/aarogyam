-- A prescription link records how it was handed to the patient: the two new choices are a QR
-- code shown on screen and a plain link. Widens the allowed values; existing rows are unchanged.
set local lock_timeout = '5s';

alter table aarogyam.share_links drop constraint share_links_channel_check;
alter table aarogyam.share_links
  add constraint share_links_channel_check
    check (channel in ('whatsapp', 'sms', 'email', 'print', 'qr', 'link'));
