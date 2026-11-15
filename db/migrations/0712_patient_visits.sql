-- What opens for a signed-in patient account, and why: the patient app lists a patient's past
-- visits (GET /me/patient/visits). Until now `encounters`, `procedures` and `recalls` were
-- deny-all to patient accounts (0261). This migration opens, read-only and for the linked
-- patient only:
--   * encounters: the patient's own visits that are closed (never an open visit);
--   * procedures: the done rows of an own closed visit (row-level security cannot hide a
--     column, so `price_paise` is readable in SQL; the API selects name, tooth and surfaces only);
--   * recalls: the patient's own (kind and due date, for "next follow-up").
-- `clinical_notes` stays closed. The advice a patient sees is the Plan section of the visit's
-- signed notes only, through app.visit_advice(), a security definer function that checks the
-- caller owns the visit and reads nothing else (subjective, objective and assessment never
-- leave it).
-- Staff and public pages are unchanged. Patients never write: `with check` still denies a
-- patient account on all three tables.
set local lock_timeout = '5s';

drop policy patient_account on aarogyam.encounters;
create policy patient_account on aarogyam.encounters as restrictive to app_user
  using ((select app.actor_kind()) <> 'patient_account'
         or (patient_id = (select app.linked_patient_id()) and status = 'closed'))
  with check ((select app.actor_kind()) <> 'patient_account');

drop policy patient_account on aarogyam.procedures;
create policy patient_account on aarogyam.procedures as restrictive to app_user
  using ((select app.actor_kind()) <> 'patient_account'
         or (patient_id = (select app.linked_patient_id())
             and exists (select 1 from aarogyam.encounters e
                         where e.org_id = procedures.org_id and e.id = procedures.encounter_id
                           and e.patient_id = procedures.patient_id and e.status = 'closed')
             and status = 'done'))
  with check ((select app.actor_kind()) <> 'patient_account');

drop policy patient_account on aarogyam.recalls;
create policy patient_account on aarogyam.recalls as restrictive to app_user
  using ((select app.actor_kind()) <> 'patient_account'
         or patient_id = (select app.linked_patient_id()))
  with check ((select app.actor_kind()) <> 'patient_account');

-- The Plan sections of the signed notes of one of the caller's own closed visits, oldest
-- first, joined by a blank line; null when there is none (or the visit is not theirs).
create function app.visit_advice(encounter_id uuid) returns text
  language sql stable security definer set search_path = ''
  as $$
    select nullif(pg_catalog.string_agg(pg_catalog.btrim(n.body ->> 'plan'), E'\n\n'
                                        order by n.signed_at, n.id), '')
    from aarogyam.clinical_notes n
    join aarogyam.encounters e on e.org_id = n.org_id and e.id = n.encounter_id
    where n.encounter_id = visit_advice.encounter_id
      and n.org_id = app.tenant_id()
      and e.patient_id = app.linked_patient_id()
      and e.status = 'closed'
      and n.status = 'signed'
      and n.kind in ('soap', 'progress', 'procedure')
      and pg_catalog.jsonb_typeof(n.body -> 'plan') = 'string'
      and pg_catalog.btrim(n.body ->> 'plan') <> ''
  $$;
revoke all on function app.visit_advice(uuid) from public;
grant execute on function app.visit_advice(uuid) to app_user;
