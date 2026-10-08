-- Walk-in in one step (docs/decisions.md, "Walk-in fast path").
--
-- Allergies the front desk records are patient-reported until a clinician confirms them. That
-- needs no new allergy columns: `source = 'patient'` says who it came from and a null
-- `verified_by`/`verified_at` says nobody has confirmed it yet (clinician entries are verified
-- by whoever records them). Confirming fills both.
--
-- patients.allergies_reviewed records "No known allergies" explicitly, so an empty list is no
-- longer ambiguous: unknown (never asked), none_known, or has_allergies.
--
-- intake.write lets the front desk record patient-reported allergies and the "No known
-- allergies" mark when registering a walk-in. It grants no clinical reading. Its catalogue
-- module is `intake` (a key's module is its prefix).
--
-- encounters.queue_token_id links a visit to the queue token it was started from: at most one
-- visit per token, for the same patient (composite key through queue_tokens' new unique key).
set local lock_timeout = '5s';

alter table aarogyam.patients
  add column allergies_reviewed text not null default 'unknown'
    check (allergies_reviewed in ('unknown', 'none_known', 'has_allergies')),
  add column allergies_reviewed_at timestamptz,
  add constraint patients_allergies_reviewed_at
    check ((allergies_reviewed = 'unknown') = (allergies_reviewed_at is null));

-- Patients who already have an active allergy on record have, in effect, been asked.
update aarogyam.patients p
set allergies_reviewed = 'has_allergies', allergies_reviewed_at = now()
where exists (select 1 from aarogyam.allergies a
              where a.org_id = p.org_id and a.patient_id = p.id and a.status = 'active');

-- The allergy review is clinical bookkeeping, not an edit of the patient's details: it must
-- not make a front desk edit (If-Match) stale.
drop trigger row_version on aarogyam.patients;
create trigger row_version before update on aarogyam.patients
  for each row execute function app.bump_row_version(
    'last_visit_at', 'search_name', 'allergies_reviewed', 'allergies_reviewed_at');

insert into aarogyam.permissions (key, module, description) values
  ('intake.write', 'intake', 'Record patient-reported allergies and "No known allergies" at registration');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, 'intake.write', 'all'
from aarogyam.role_templates t
where t.key in ('owner', 'doctor', 'front_desk', 'assistant');

-- Clinics that exist already got their standard roles from the templates; give those the same.
insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null and tp.permission = 'intake.write'
on conflict do nothing;

alter table aarogyam.queue_tokens
  add constraint queue_tokens_id_patient unique (org_id, id, patient_id);

alter table aarogyam.encounters
  add column queue_token_id uuid,
  add constraint encounters_queue_token_fk
    foreign key (org_id, queue_token_id, patient_id)
    references aarogyam.queue_tokens (org_id, id, patient_id);
-- One visit per token; also serves the foreign key.
create unique index encounters_queue_token on aarogyam.encounters (org_id, queue_token_id, patient_id)
  where queue_token_id is not null;
