-- A consent's signature can be attached after the consent is recorded (the walk-in records the
-- consents, the patient then signs on the tablet), exactly once. patient_consents is final from
-- the moment it is given (app.freeze_when_final), so two things change:
--  * the freeze trigger skips the one update that sets signature_attachment_id from null to a
--    value on a consent still `given`, and changes nothing else (the freeze stays as strict for
--    every other change);
--  * the signature guard now also runs when signature_attachment_id is updated: the file must be
--    of kind consent (as on insert) and a value already set can never change or be cleared.
-- app_user already holds table-level update on this table (finalizable lifecycle), so no new grant.
set local lock_timeout = '5s';

create or replace function app.check_consent_signature() returns trigger
  language plpgsql set search_path = ''
  as $$
  declare
    v_kind text;
  begin
    if tg_op = 'UPDATE' and old.signature_attachment_id is not null
       and new.signature_attachment_id is distinct from old.signature_attachment_id then
      raise exception 'a consent signature is set once and cannot change'
        using errcode = 'check_violation';
    end if;
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

drop trigger consent_signature on aarogyam.patient_consents;
create trigger consent_signature before insert or update of signature_attachment_id
  on aarogyam.patient_consents
  for each row execute function app.check_consent_signature();

drop trigger freeze_when_final on aarogyam.patient_consents;
create trigger freeze_when_final before update on aarogyam.patient_consents
  for each row
  when (not (old.signature_attachment_id is null and new.signature_attachment_id is not null
             and old.status = 'given' and new.status = 'given'
             and (to_jsonb(new) - 'signature_attachment_id') = (to_jsonb(old) - 'signature_attachment_id')))
  execute function app.freeze_when_final('', 'withdrawn', 'withdrawn_at', 'withdrawn_by', 'withdrawn_method', 'withdrawal_note');
