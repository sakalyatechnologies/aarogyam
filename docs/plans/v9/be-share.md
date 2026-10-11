# BE8 visit share (be-share) - WIP, paused 12:50

Branch v9-be-share (base 60047b9). Nothing pushed. Test status: NOT compiling, no tests run.

## Done (written, unverified)
- db/migrations/0425_visit_share_links.sql: resource `visit`, `share_links.encounter_id` (composite FK to encounters), `app.visit_advice(encounter)` (Plan section of SIGNED notes only; S/O/A never leave), patient_account RLS opened for own encounters, done procedures, open recalls.
- crates/aarogyam-dal/src/visit_shares.rs: insert link, heads, treatments, prescriptions, next_follow_up.
- crates/aarogyam-app/src/visit_share.rs: create, open (PIN, lock, expiry, access log), list/get for the patient app, summary compose. `read_clinic` in patient_app.rs made pub(crate).
- docs/schema/model.py, database.md, schema.json regenerated.

## Left
1. Compile: aarogyam-dal fails (7 errors, `!` is not an iterator) because sqlx macros need the 0425 schema. Migrate DB aarogyam_dev_share (`ARO_DB__OWNER_URL=postgres://aarogyam_owner@localhost:5432/aarogyam_dev_share cargo run -p aarogyam-server -- migrate`, which itself needs dal to build: use SQLX_OFFLINE=true for that, or `psql -f` the migration), then build with DATABASE_URL pointing at it.
2. API: crates/aarogyam-api/src/v1/visit_shares.rs; routes in v1/mod.rs:
   - `POST /visits/{id}/share` (Require<ClinicalRead>, RequestHost; returns id, token, pin, expires_at, path `/shared/{token}`, url via `notifier().links().shared(host, token)`).
   - `POST /shared/{token}/visit` with `{pin}` (same 403/410/423 as records). Today's PIN open is POST, not GET.
   - `GET /me/patient/visits`, `GET /me/patient/visits/{id}` (PatientRequest / PatientAtClinic).
   - Add PortalLinks method for `/public/booking`; update SharedPreview docs (resource may be `visit`); register in openapi.rs.
3. Tests (new tests/visit_shares.rs): wrong PIN, expired, cross-clinic token and cross-clinic create 404, permission 403, S/O excluded, patient app other-patient 404.
4. `UPDATE_OPENAPI=1 cargo test -p aarogyam-api openapi`, `scripts/sqlx-prepare.sh`, clippy -D warnings, DB tests.

## For web public page and BE7 templates
- Link: `https://{clinic host}/shared/{token}`; PIN sent separately. No patient name in the URL.
- Preview: `GET /shared/{token}` gives resource `visit`; then POST the PIN to `/shared/{token}/visit`.
- Fields: number, clinic_name, visited_on, doctor_name, treatments[{name,tooth,surfaces}], advice, prescription{number,issued_on,items[]}, next_follow_up{due_on,kind}, earlier_visits[{visited_on,title}] (max 5), booking path `/public/booking`.
- No fees at all. Advice = Plan of signed notes only.
