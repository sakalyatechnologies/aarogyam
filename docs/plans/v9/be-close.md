# be-close (BE5 + BE6): handoff, WIP

Status: code written, NOT compiled or tested. Stopped at the coordinator's pause.

## Built (uncommitted-green: unverified)
- Migration 0422: `recalls.source_encounter_id` with composite FK to encounters.
- Migration 0423: `payments.attachment_id` (composite FK), attachment kind `payment_proof`.
- `POST /api/v1/visits/{id}/close`: optional body `{follow_up_on, follow_up_reason, fee_paise, note}`.
  Response is the visit plus `recall_id` and `invoice_id` (flattened, so non-breaking).
  One transaction: close, recall, draft invoice (priced done procedures + one "Consultation fee" line).
  An existing non-void invoice on the visit is returned, no second one. Empty body = old behaviour.
  Needs patients.write for a follow-up, billing.write for a fee; past date or fee <= 0 is 400.
- `POST /payments` takes `attachment_id` (must be same patient, kind payment_proof); reads return it.

## Files touched
dal: recalls.rs, visits.rs, billing.rs. app: visits.rs, billing.rs (`create_in`), payments.rs.
api: v1/visits.rs, v1/payments.rs. domain: clinical.rs (AttachmentKind). docs/schema/model.py.
Tests: crates/aarogyam-api/tests/visit_close.rs (new, never run).

## Left
1. DB `aarogyam_dev_close` is a clone of aarogyam_dev, 0422/0423 applied by psql, but it lacks
   newer migrations (avatars, audiences...), so sqlx macros fail. Run
   `cargo run -p aarogyam-server -- migrate` against it first (owner_url), then
   `scripts/sqlx-prepare.sh` with DATABASE_URL set to it.
2. cargo check/clippy/test -p aarogyam-{dal,app,api}; fix compile errors.
3. `UPDATE_OPENAPI=1 cargo test -p aarogyam-api openapi`; `python3 scripts/gen_schema_docs.py`.
4. Run DB tests with `-- --include-ignored`. Check front_desk lacks clinical.write (403 test).
5. Mobile: send the optional body; read `recall_id`/`invoice_id`; upload proof with kind
   `payment_proof`, then pass `attachment_id` to POST /payments.
