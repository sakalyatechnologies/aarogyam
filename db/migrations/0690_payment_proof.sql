-- A payment can point at a file that proves it: the screenshot of a UPI transfer, a card slip,
-- a bank advice. The file is an ordinary patient file of the new kind `payment_proof`; the
-- payment names it with attachment_id. Expand only: existing payments have none, and the
-- column is set once when the payment is recorded (a payment is final afterwards).
set local lock_timeout = '5s';

alter table aarogyam.attachments drop constraint attachments_kind_check;
alter table aarogyam.attachments add constraint attachments_kind_check
  check (kind in ('photo', 'xray', 'report', 'document', 'audio', 'consent', 'payment_proof'));

-- The target of the payment's key, so the proof and the payment agree on the patient.
create unique index attachments_id_patient on aarogyam.attachments (org_id, id, patient_id);

alter table aarogyam.payments add column attachment_id uuid;
alter table aarogyam.payments add constraint payments_attachment_fk
  foreign key (org_id, attachment_id, patient_id)
  references aarogyam.attachments (org_id, id, patient_id);
create index payments_attachment on aarogyam.payments (org_id, attachment_id, patient_id)
  where attachment_id is not null;

-- The backstop for the API's check: only a file of kind payment_proof is a proof.
create function app.check_payment_proof() returns trigger
  language plpgsql set search_path = ''
  as $$
  declare
    v_kind text;
  begin
    if new.attachment_id is not null then
      select a.kind into v_kind from aarogyam.attachments a
      where a.org_id = new.org_id and a.id = new.attachment_id;
      if v_kind is distinct from 'payment_proof' then
        raise exception 'a payment proof must be a file of kind payment_proof'
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end
  $$;
create trigger payment_proof before insert on aarogyam.payments
  for each row execute function app.check_payment_proof();
