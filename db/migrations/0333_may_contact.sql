-- Consent drives messaging (DPDP): may this clinic send this patient a message for this
-- purpose, by the patient's consents (patient_consents) right now?
--
--   care                          allowed unless the patient withdrew consent to care and has
--                                 not given it again (booking confirmations, prescription links)
--   reminders, promotional,       only with a consent for that purpose in force; no row means
--   sharing, research             no (appointment reminders and recalls, campaigns, birthdays)
--
-- Which message needs which purpose is decided in code (aarogyam_domain::contact). The sender
-- calls this at send time, so a withdrawal stops messages already queued and consenting again
-- restores them. The signature is stable: app.may_contact(org_id, patient_id, purpose).
--
-- Security definer, so the notification worker can call it without a clinic transaction; it
-- answers only about the clinic named, and inside a clinic transaction only about that clinic.
-- An unknown, deleted or merged patient may not be contacted.
set local lock_timeout = '5s';

create function app.may_contact(p_org_id uuid, p_patient_id uuid, p_purpose text)
  returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from aarogyam.patients p
      where p.org_id = p_org_id and p.id = p_patient_id
        and p.deleted_at is null and p.status <> 'merged'
        and (app.tenant_id() is null or app.tenant_id() = p_org_id)
        and case
          when p_purpose = 'care' then
            exists (select 1 from aarogyam.patient_consents g
                    where g.org_id = p.org_id and g.patient_id = p.id and g.purpose = 'care'
                      and g.status = 'given')
            or not exists (select 1 from aarogyam.patient_consents w
                           where w.org_id = p.org_id and w.patient_id = p.id
                             and w.purpose = 'care' and w.status = 'withdrawn')
          else exists (
            select 1 from aarogyam.patient_consents g
            where g.org_id = p.org_id and g.patient_id = p.id and g.purpose = p_purpose
              and g.status = 'given')
        end)
  $$;
revoke all on function app.may_contact(uuid, uuid, text) from public;
grant execute on function app.may_contact(uuid, uuid, text) to app_user, aarogyam_api;
comment on function app.may_contact(uuid, uuid, text) is
  'Whether the clinic may message the patient for a consent purpose now (see migration 0333).';
