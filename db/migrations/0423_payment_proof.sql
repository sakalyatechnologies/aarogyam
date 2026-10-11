-- A payment can carry proof: a screenshot of the UPI payment or a photo of the cheque.
set local lock_timeout = '5s';

alter table aarogyam.attachments drop constraint attachments_kind_check;
alter table aarogyam.attachments add constraint attachments_kind_check
  check (kind in ('photo', 'xray', 'report', 'document', 'audio', 'consent', 'payment_proof'));

alter table aarogyam.payments add column attachment_id uuid;
alter table aarogyam.payments
  add foreign key (org_id, attachment_id) references aarogyam.attachments (org_id, id);
create index payments_attachment on aarogyam.payments (org_id, attachment_id)
  where attachment_id is not null;
