-- A correction to a signed note is a new signed note that points at the one it replaces, in the
-- same visit. The original stays exactly as it was signed (the freeze trigger keeps it); readers
-- list only the note that no live correction replaces, and earlier versions are read separately.
-- A note has at most one live correction: one marked entered in error stops counting, so the
-- original is current again and can be corrected anew.
set local lock_timeout = '5s';

alter table aarogyam.clinical_notes add column supersedes_id uuid;
alter table aarogyam.clinical_notes
  add constraint clinical_notes_supersedes_fk
  foreign key (org_id, supersedes_id, encounter_id)
  references aarogyam.clinical_notes (org_id, id, encounter_id);
alter table aarogyam.clinical_notes
  add constraint clinical_notes_supersedes_not_self check (supersedes_id is distinct from id);
create unique index clinical_notes_supersedes on aarogyam.clinical_notes (org_id, supersedes_id)
  where supersedes_id is not null and status <> 'entered_in_error';
create index clinical_notes_supersedes_fk_idx on aarogyam.clinical_notes (org_id, supersedes_id, encounter_id);

-- The advice a patient sees is the Plan of the visit's current signed notes: a note replaced by a
-- live correction no longer counts, so the patient never sees both versions.
create or replace function app.visit_advice(encounter_id uuid) returns text
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
      and not exists (select 1 from aarogyam.clinical_notes s
                      where s.org_id = n.org_id and s.supersedes_id = n.id
                        and s.status <> 'entered_in_error')
  $$;
