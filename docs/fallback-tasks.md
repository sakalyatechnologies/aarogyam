# Fallback task queue

Small, self-contained tasks for fallback agents (rules in `docs/fallback-agent.md`). Claude adds tasks, reviews `fallback/*` branches and marks them merged. Take only `open` tasks; tasks whose **Conflicts** overlap must not run at the same time.

Status: `open` · `in review` (branch exists) · `merged` · `redo`.

---

## FB-01 Patient 360: links to the patient's bills and prescriptions — open
- **Why:** billing and prescriptions are reachable only from the nav; staff expect them on the patient.
- **Allowed:** `web/apps/portal/src/pages/patients/**`
- **Read:** `web/apps/portal/src/pages/patients/` (the Patient 360 page), `web/apps/portal/src/routes.tsx`, `web/apps/portal/src/pages/billing/` (how a bill is started for a patient)
- **Do:** on Patient 360 add "New bill" and "New prescription" actions and short lists of the patient's recent bills and prescriptions, using existing api-client calls only. Hide actions the member lacks permission for (`useClinic().can`).
- **Done when:** `pnpm check` passes; a Vitest test covers the actions and lists with the fake client.
- **Conflicts:** FB-02

## FB-02 Allergy editing on Patient 360 — open
- **Allowed:** `web/apps/portal/src/pages/patients/**`
- **Read:** the allergies section of Patient 360, the allergies endpoints in `docs/api/openapi.json` (search `allergies`), `web/packages/api-client/src/`
- **Do:** add, edit and mark-inactive for allergies, with the same dialog style as other Patient 360 edits.
- **Done when:** `pnpm check`; tests for add and edit with the fake client.
- **Conflicts:** FB-01

## FB-03 Note addenda on the visit screen — open
- **Allowed:** `web/apps/portal/src/pages/visits/**`
- **Read:** the visit page's notes section, `addenda` endpoints in `docs/api/openapi.json`
- **Do:** signed notes show their addenda; "Add addendum" opens a text dialog; drafts stay editable as today.
- **Done when:** `pnpm check`; a test covers adding an addendum to a signed note.
- **Conflicts:** FB-04, FB-05

## FB-04 Treatment plans UI — open
- **Allowed:** `web/apps/portal/src/pages/visits/**`, new files under `web/apps/portal/src/pages/treatment-plans/`
- **Read:** `treatment-plans` endpoints in `docs/api/openapi.json`, the visit page
- **Do:** list a patient's plans, create a plan with items (procedure, tooth, estimate), update item status. Follow the billing pages for tables and dialogs.
- **Done when:** `pnpm check`; tests for create and status change.
- **Conflicts:** FB-03, FB-05

## FB-05 Record treatment from the dental chart tab — open
- **Allowed:** `web/apps/portal/src/pages/visits/**` (dental chart components)
- **Read:** the odontogram component, `dental-chart` endpoints
- **Do:** clicking a tooth on the chart tab opens the same record dialog the visit flow uses, then refreshes the chart.
- **Done when:** `pnpm check`; a test clicks a tooth and records a finding.
- **Conflicts:** FB-03, FB-04

## FB-06 Unique OpenAPI operation ids — open (Rust; one at a time)
- **Allowed:** `crates/aarogyam-api/src/v1/**` (only `operation_id` attributes in `#[utoipa::path]`), `docs/api/openapi.json`, `web/packages/api-client/src/**` (only renamed generated names)
- **Read:** `cargo test -p aarogyam-api openapi` output, `docs/api/openapi.json`
- **Do:** give every operation a unique, descriptive `operation_id` so the web generator stops renaming duplicates. No path, method or schema changes.
- **Done when:** full Rust check and `pnpm check` pass; openapi regenerated.
- **Conflicts:** none

## FB-07 Vitest coverage for billing — open
- **Allowed:** `web/apps/portal/src/pages/billing/**/*.test.tsx` (new test files only)
- **Read:** `web/apps/portal/src/pages/billing/`, an existing page test such as `src/pages/calendar/calendar-page.test.tsx`
- **Do:** tests for creating a bill, issuing it (number appears, lines frozen), recording a payment and voiding with a reason, against the fake client. Don't change non-test files; report bugs you find.
- **Done when:** `pnpm check`.
- **Conflicts:** none
