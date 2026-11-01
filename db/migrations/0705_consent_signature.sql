-- A consent can carry the patient's signature: a patient file of kind `consent` (the scanned or
-- drawn signature), named by signature_attachment_id when the consent is recorded. Expand only:
-- existing consents have none; the column is set once at insert (a consent is history).
set local lock_timeout = '5s';

alter table aarogyam.patient_consents add column signature_attachment_id uuid;
alter table aarogyam.patient_consents add constraint patient_consents_signature_fk
  foreign key (org_id, signature_attachment_id, patient_id)
  references aarogyam.attachments (org_id, id, patient_id);
create index patient_consents_signature on aarogyam.patient_consents (org_id, signature_attachment_id, patient_id)
  where signature_attachment_id is not null;

-- The backstop for the API's check: only a file of kind consent is a signature.
create function app.check_consent_signature() returns trigger
  language plpgsql set search_path = ''
  as $$
  declare
    v_kind text;
  begin
    if new.signature_attachment_id is not null then
      select a.kind into v_kind from aarogyam.attachments a
      where a.org_id = new.org_id and a.id = new.signature_attachment_id;
      if v_kind is distinct from 'consent' then
        raise exception 'a consent signature must be a file of kind consent'
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end
  $$;
create trigger consent_signature before insert on aarogyam.patient_consents
  for each row execute function app.check_consent_signature();
