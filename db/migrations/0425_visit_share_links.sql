-- A link to one visit: what the patient sees after leaving the clinic (the treatments done, the
-- advice, the next follow-up). Same share_links table, token and PIN, resource 'visit'. The
-- link targets an encounter of the same patient.
--
-- Advice is the Plan section of the visit's signed notes and nothing else. It is read through
-- app.visit_advice, so the Subjective, Objective and Assessment sections never leave the
-- database for a patient account or a public link, and a patient account needs no read on
-- clinical_notes.
--
-- The patient app (patient account actor) also reads its own visits, their procedures and its
-- own recalls: the restrictive patient_account policies of 0261 are widened for those three
-- tables only.
set local lock_timeout = '5s';

alter table aarogyam.share_links drop constraint share_links_resource_check;
alter table aarogyam.share_links
  add constraint share_links_resource_check
    check (resource in ('prescription', 'invoice', 'report', 'upload_request', 'records', 'visit')),
  add column encounter_id uuid,
  add constraint share_links_encounter_fk
    foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id),
  add constraint share_links_visit check ((resource = 'visit') = (encounter_id is not null));
create index share_links_encounter on aarogyam.share_links (org_id, encounter_id, patient_id)
  where encounter_id is not null;

create function app.visit_advice(p_encounter uuid) returns text
  language sql stable security definer set search_path = ''
  as $$
    select string_agg(btrim(n.body #>> '{plan}'), E'\n\n' order by n.created_at, n.id)
    from aarogyam.clinical_notes n
    where n.org_id = app.tenant_id()
      and n.encounter_id = p_encounter
      and n.status = 'signed'
      and coalesce(btrim(n.body #>> '{plan}'), '') <> ''
      and (app.actor_kind() <> 'patient_account' or n.patient_id = app.linked_patient_id())
  $$;
grant execute on function app.visit_advice(uuid) to app_user;
revoke execute on function app.visit_advice(uuid) from public;

do $$
declare
  t text;
  rule text;
  staff text := '(select app.actor_kind()) <> ''patient_account''';
  own text := 'patient_id = (select app.linked_patient_id())';
begin
  foreach t in array array['encounters', 'procedures', 'recalls'] loop
    rule := case t
      when 'procedures' then own || ' and status = ''done'''
      when 'recalls' then own || ' and status in (''due'', ''notified'')'
      else own
    end;
    execute format('drop policy patient_account on aarogyam.%I', t);
    execute format('create policy patient_account on aarogyam.%I as restrictive to app_user
                    using (%s or (%s)) with check (%s or (%s))', t, staff, rule, staff, rule);
  end loop;
end $$;
