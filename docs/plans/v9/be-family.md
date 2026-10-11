# be-family (BE1): family profiles under one mobile number

Status: PAUSED at the coordinator's stop. WIP commit; nothing compiled beyond a domain check, no tests run.

## Done (written, unverified)
- db/migrations/0424_patient_relations.sql: table (text+CHECK relation, ephemeral lifecycle, composite FKs,
  unique (org_id, patient_id, related_patient_id), patient_id <> related_patient_id), RLS via protect_clinic_table,
  erasure step.
- domain: family.rs (Relation, inverse(), check_link, tests), PatientRelationId, Event::FamilyLinked/Unlinked.
- dal: family.rs (list, insert, delete_pair, groups) using sqlx macros (needs sqlx-prepare).
- app: family.rs (list, add, remove, link_in for walk-ins).

## Left
- Confirm migration applies: DB aarogyam_dev_fam was created; `cargo run -p aarogyam-server -- migrate` was running in
  the background with ARO_DB__URL/OWNER_URL pointing at it.
- api: v1/family.rs (GET/POST /patients/{id}/family, DELETE .../{relation_id}; Require<PatientsRead/PatientsWrite>,
  utoipa, routes in v1/mod.rs, openapi.rs), log Event::FamilyLinked with ids only.
- lookup: add `family_group` (additive) to PhoneMatch in app/patients.rs + api/v1/patients.rs using dal::family::groups.
- walk-in: optional `family_of {patient_id, relation}` in api/v1/walk_ins.rs + app/walk_ins.rs calling family::link_in.
- Tests: api cross-clinic 404 (BETA) per endpoint, walk-in family_of, lookup group, delete removes inverse.
- model.py: replace the planned `family_links` entry with patient_relations; run gen_schema_docs.py.
- Run: `DATABASE_URL=postgres://aarogyam_owner@localhost:5432/aarogyam_dev_fam scripts/sqlx-prepare.sh`,
  `UPDATE_OPENAPI=1 cargo test -p aarogyam-api openapi`, clippy -D warnings, tests --include-ignored.

## Next step
`cargo check -p aarogyam-app` (fix compile errors), then api layer.

Inverse rule: guardian->child, parent->child, child->parent, spouse/sibling/other symmetric; delete removes both rows.
