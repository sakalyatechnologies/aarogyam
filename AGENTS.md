# AGENTS.md: aarogyam

Aarogyam is a multi-specialty clinic and patient health platform run by Sakalya Technologies. This repository holds the product: the Rust API and workers, database migrations, the clinic portal and console, the phone apps, and the specialty module definitions.

Patient health data lives here. Every rule below exists to protect it.

## Read before writing code

0. `docs/handoff.md`: where the work stands and what to do next. Then `docs/product.md`: what Aarogyam is, who uses it, features and phases.
1. `docs/guidelines/principles.md`, then the rest of `docs/guidelines/` and `docs/vendor/`: the shared Sakalya rules, copied from `sakalya-backend` by `scripts/sync-guidelines.sh`. Edit them there.
2. `docs/architecture.md`: layers, crates, tenancy, and how a request flows.
3. `docs/database.md`: every table, column and relationship (generated; edit `docs/schema/model.py` and run `python3 scripts/gen_schema_docs.py`). `docs/data-model.md` has the identifier and schema rules.
4. `docs/cicd.md`: how code reaches staging and production.
5. `docs/decisions.md`: decisions already made. Don't reopen them in code; propose a change in that file instead.

## Commands

Scope every command to what you changed. See `docs/guidelines/build-speed.md`.

| Task | Command |
|---|---|
| Fast feedback | `cargo check -p <crate>` |
| Build the server | `cargo build -p aarogyam-server` (binary `target/debug/aarogyam`) |
| Tests for one crate | `cargo test -p <crate>` |
| Database tests | `DATABASE_URL=postgres://localhost:5432/postgres cargo test -p <crate> -- --include-ignored` |
| Lint | `cargo clippy -p <crate> --all-targets -- -D warnings` |
| Apply migrations | `cargo run -p aarogyam-server -- migrate` |
| Run the API | `cargo run -p aarogyam-server -- serve`, then `curl localhost:8080/healthz` |
| Regenerate the OpenAPI document | `UPDATE_OPENAPI=1 cargo test -p aarogyam-api openapi` |
| Final check before commit | `cargo fmt --all --check && cargo clippy --workspace --all-targets --all-features -- -D warnings && cargo test --workspace --all-features && cargo deny check` |

Settings come from `config/local.toml` (local defaults, not secret) and `ARO_*` environment variables, which win. `.env.example` lists every variable.

## Product rules (on top of the shared rules)

1. **The clinic comes from the host name.** `smilecatchers.aarogyam.example` means clinic `smilecatchers`. Never read the clinic from a header, path segment or body. The API checks the host against the caller's memberships.
2. **Clinic data is only read inside a scoped transaction.** Use `sakalya_db::Db::begin_scoped` through the product's `ClinicTx` wrapper. Never query clinic tables with `Db::pool()`.
3. **Every clinic table has `org_id`, row-level security, and composite foreign keys** that include `org_id`. A migration that adds a clinic table without all three fails review.
4. **Every route declares its permission** with a typed extractor such as `Require<PatientsRead>`. A test fails the build if a route has none.
5. **Every endpoint has a cross-clinic test**: a member of clinic B must get `404` for clinic A's record.
6. **No patient data in logs, URLs, push payloads, analytics or error messages.** Log IDs. URLs carry clinic numbers (`SC-1042`) or IDs, never names, phone numbers or diagnoses.
7. **Strong types everywhere.** `Id<Patient>`, `Paise`, `PhoneE164`, `Slug`, and enums for statuses. Raw `Uuid`, `String` or `i64` for a domain value fails review.
8. **Layers point inwards.** `domain` (pure rules) ← `dal` (SQL) ← `app` (use cases) ← `api` (HTTP). The domain crate has no I/O and no async.
9. **Migrations are append-only.** Never edit a merged migration. Change schemas with expand, then contract, across two releases.
10. **Messages go through the notification service.** Handlers write an outbox row; they never call SMS, WhatsApp or push providers directly.
11. **Specialty modules are data.** Forms, templates and vocabularies live in `specialties/` as schemas. Only signature visuals (such as the tooth chart) are code.
12. **The API contract is generated.** Annotate routes for OpenAPI; the committed spec (`docs/api/openapi.json`) must match, and breaking changes fail CI.

## Logging

Follow the log budget in `docs/guidelines/observability.md`. Business events use the `Event` enum (`appointment.booked`, `invoice.paid`) in the `event` field. Log IDs only.

## Hooks

Run `scripts/install-hooks.sh` once per clone. The pre-commit hook runs the final check and `cargo machete`, adds the database tests when Postgres answers on localhost, and fails if `docs/database.md` is stale after a change to `docs/schema/model.py`. Claude Code formats each Rust file it edits. CI is parked for now, so the hook is the gate.

## Done means

- [ ] Shared and product rules followed; final check passes.
- [ ] New endpoints have a permission, a cross-clinic test, and OpenAPI annotations.
- [ ] New clinic tables have `org_id`, RLS, composite foreign keys and a policy test.
- [ ] Docs updated when behaviour or a decision changed.
- [ ] Small Conventional Commits.
