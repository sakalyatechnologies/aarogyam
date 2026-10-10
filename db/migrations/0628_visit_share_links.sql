-- A link to a visit summary: what the patient may see of one visit (the treatments done, the
-- follow-up date and a way to book), opened with the same token and PIN as the other share links
-- (resource 'visit'). The link names its visit; a visit and patient that don't belong together
-- can't be linked. Widens the allowed resources and adds one nullable column; existing links are
-- unchanged. Nothing new has a patient_id, so audit.erasure_steps already covers it.
set local lock_timeout = '5s';

alter table aarogyam.share_links drop constraint share_links_resource_check;
alter table aarogyam.share_links
  add constraint share_links_resource_check
    check (resource in ('prescription', 'invoice', 'report', 'upload_request', 'records', 'visit')),
  add column encounter_id uuid,
  add constraint share_links_encounter_fk foreign key (org_id, encounter_id, patient_id)
    references aarogyam.encounters (org_id, id, patient_id),
  add constraint share_links_visit check ((resource = 'visit') = (encounter_id is not null));
create index share_links_encounter on aarogyam.share_links (org_id, encounter_id, patient_id)
  where encounter_id is not null;
