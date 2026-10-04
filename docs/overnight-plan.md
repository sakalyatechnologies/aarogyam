# Overnight plan, 3–4 Oct 2026

Goal for **10:30 PDT**: the dental golden journey works end to end locally, in the API and the web portal, with tests. Patient → appointment → arrival and queue → visit (notes, vitals, allergies, dental chart, procedures, treatment plan) → prescription (allergy check, print with footer and QR, patient link with PIN) → invoice with GST → payment and receipt → follow-up. The dashboard and screens follow the founder's mock-up (`~/Downloads/aarogyam-dashboard-full.html`, specified in `docs/ui-spec.md`).

**Not tonight:** phone apps, deploys, Razorpay, WhatsApp and SMS (email goes through the outbox, logged locally), and Phase 2 screens from the mock-up (inventory, recall campaigns, website, notifications), which stay static.

## Usage windows

| Window | Budget | Work |
|---|---|---|
| 22:55–00:30 | 28% | UI spec from the mock-up; M2 backend; this plan |
| 00:30–05:30 | 100% | M3 backend; then M4 backend once M3's migrations are merged; web screens for M2 and M3 |
| 05:30–10:30 | 100% | M5 backend; web screens for visits, prescriptions and billing; Playwright golden journey; merge, verify, handoff by 10:15 |

At most three agents at a time. Backend agents use the default model; web and test agents use Sonnet. Prompts scheduled at 00:33 and 05:33 resume whatever the limit interrupted.

## Work packages

Each backend package works in its own worktree and branch, with its own dev database (`DB=aarogyam_dev_<pkg> scripts/dev-db.sh`; `DATABASE_URL=postgres://aarogyam_owner@localhost:5432/aarogyam_dev_<pkg> scripts/sqlx-prepare.sh`). It owns a block of migration numbers so branches never collide.

| Package | Branch | Migrations | Tables (columns in `docs/schema/model.py`) | API (all under `/api/v1`) | Permissions |
|---|---|---|---|---|---|
| **M2 basics** | `feat/m2-basics` | 0015–0019 | `outbox_events` (+ a `messages` log) | `PATCH /patients/{id}`; staff: `GET /staff`, `POST /staff/invitations`, `PATCH /staff/{membership_id}` (role, suspend; never remove the last owner), `GET /roles`; `GET /me/sessions`, `POST /me/sessions/{id}/revoke`; `GET`/`PATCH /settings/clinic` (profile, GSTIN, branding); outbox enqueue + `POST /internal/outbox/drain` (local: log channel; Resend when `RESEND_API_KEY` is set) | patients.write, staff.manage, settings.manage |
| **M3 front desk** | `feat/m3-front-desk` | 0020–0029 | `rooms`, `practitioners`, `working_hours`, `leave_blocks`, `appointments` (one active booking per room at a time, exclusion constraint), `appointment_events`, `queue_tokens`, `patient_identifiers`, `imports`, `import_rows` | rooms and practitioners CRUD; working hours; `GET /appointments?from&to&room_id&practitioner_id`, `POST /appointments`, `PATCH /appointments/{id}`, `POST /appointments/{id}/status` (arrive issues a queue token; cancel needs a reason); `GET /queue?date`, `POST /queue` (walk-in); `GET /today` (schedule, chair status, attention list, appointments by hour, recent patients, team today); `POST /imports/patients` (CSV, preview then commit) | appointments.read/write, settings.manage, patients.write |
| **M4 visit** | `feat/m4-visit` | 0030–0039 | `encounters`, `clinical_notes`, `note_addenda`, `observations`, `conditions`, `allergies`, `specialty_records` (dental chart, FDI teeth, superseding rows), `procedures`, `treatment_plans`, `treatment_plan_items`, `attachments` | visits per patient (start from an appointment or walk-in, close); notes (draft, edit draft, sign, addenda); vitals; conditions and allergies (clinical flags); `GET`/`POST /patients/{id}/dental-chart`; procedures; treatment plans and items; attachments (multipart ≤ 10 MB, local disk in dev, short-lived download token, access record); `GET /patients/{id}/timeline` | clinical.read/write |
| **M5 Rx and money** | `feat/m5-rx-billing` | 0040–0049 | `price_items`, `invoices`, `invoice_items`, `payments`, `payment_allocations`, `drug_catalog` (seed ~100 common dental drugs), `prescriptions`, `prescription_items`, `prescription_alerts`, `share_links`, `recalls`, `document_templates` | price list; invoices (draft, issue with number `XX/26-27/000001` per financial year in clinic time, GST CGST/SGST per line, freeze after issue, void with reason); payments (cash, UPI, card, bank; allocations; receipt number; void with reason); `GET /reports/collections` (weekly collections, revenue mix), pending payments; drug search; prescriptions (draft, issue with allergy check and override reason, cancel and reissue, Quick Rx from the last one); share link with a PIN (public `GET /shared/{token}`, `POST /shared/{token}/open`, throttled, lockout); follow-ups (`recalls`) | billing.read/write, finance.view, prescriptions.issue |
| **UI 1** | main checkout, `web/` | none | | Screens per `docs/ui-spec.md` for M2 and M3: dashboard (Today), patients, Patient 360 shell, week calendar and booking, queue, team and staff, settings, sessions | |
| **UI 2** | main checkout, `web/` | none | | Visit screen (notes, vitals, dental chart odontogram, procedures), treatment plans, prescription (compose, alerts, print layout with footer and QR), invoices and payments, collections; Phase 2 screens static | |
| **E2E** | main checkout | none | | Playwright golden journey on the local stack | |

### Added at 01:00 (founder: finish everything by 07:00, no waiting)

| Package | Where | What |
|---|---|---|
| **Auth** (lead) | main | Local API accepts dev tokens and Supabase tokens together; founder's Supabase user bootstrapped as platform owner; `aarogyam_api` password set on Supabase; portal and console email-code sign-in against Supabase |
| **Quality** | `feat/quality` + `web/` | `scripts/quality-run.sh` runs Rust, web and Playwright suites and writes run summaries to `var/quality/*.json` (an operations store outside the patient database; GCS or BigQuery when deployed); `GET /api/v1/console/quality` (platform staff); console Quality page (status per suite and environment, pass-rate trend, failing tests) |
| **Deploy prep** | `feat/deploy` | Product Dockerfile (builder and runtime on the same Debian), Cloud Run service YAML (min 0, max 2, request-based billing, own runtime account, secrets from Secret Manager), `cloudbuild.yaml` (main → staging, refuses other branches), Cloudflare Worker serving portal and console assets and proxying `/api` with the edge secret and `X-Forwarded-Host`, `wrangler.toml`, `docs/deploy.md` with exact commands; staging hosts `*.sakalyatech.in` |

Order: M3, M4 and M5 backends → UI 2 (calendar and queue, visit and dental chart, prescriptions, billing) → Quality and E2E → Deploy prep → merge, full gates, push, handoff by 07:00.

### Added at 01:30: real sign-in, registration and onboarding (founder)

| Package | Where | What |
|---|---|---|
| **Onboarding backend** | `feat/onboarding` | The API accepts Supabase tokens (JWKS) and, only when `environment = local` and enabled, dev tokens too. Supabase Admin client (server-only `SUPABASE_SECRET_KEY` from `.env.supabase` / Secret Manager) creates confirmed users for invitations. Platform table `clinic_applications` (clinic name, city, specialty, contact name, email, phone; pending/approved/rejected; no patient data); public `POST /api/v1/registrations` (throttled per IP, validated, never reveals whether an email exists); console `GET /console/applications`, `POST /console/applications/{id}/approve` (creates the clinic, the owner's Supabase user and invitation, outbox email) and `/reject`; console `GET /console/clinics/{id}` (members, counts) and `POST /console/clinics/{id}/invitations` (doctors and staff by email and role). `aarogyam admin grant-platform --email … --role owner` looks up the Supabase user and makes them platform staff; run it for the founder. Tests: Supabase-token path with the testkit JWKS server, applications, approval, console invitations, permissions, route audit allowlist for the public route. |
| **Onboarding UI** | `web/` | Landing page (signed out) with Sign in and Register your clinic, modelled on MyDwarpal's sign-in flow (email → 6-digit code, 60 s resend, paste, `autocomplete="one-time-code"`, no account enumeration); thank-you page; accept-invite flow with real email codes; console Applications (approve/reject) and Clinic detail (members, invite doctor/staff). Supabase mode is the default when `VITE_SUPABASE_*` is set; dev sign-in only behind `VITE_DEV_SIGN_IN=1`. |

## Rules every package follows

- The patients module is the pattern: domain values in `aarogyam-domain`, compile-checked queries in `aarogyam-dal`, use cases in `aarogyam-app` inside `db.scoped(...)`, handlers taking `Require<P>` in `aarogyam-api`, OpenAPI annotations, `docs/api/openapi.json` regenerated.
- Every new clinic table goes through `app.protect_clinic_table`, has a classification comment, and passes `db/checks/schema_lint.sql`; statuses are text with CHECK; finalised records are frozen by trigger.
- Tests per package: unit tests for rules; database tests with `support::TestApp` covering cross-clinic 404, missing permission 403 and the main flows. The route audit covers every new route automatically; public share-link routes are added to its allowlist explicitly.
- Small Conventional Commits that pass the pre-commit gate. Never push or change settings; the lead merges.
- Report under 300 words: commits, endpoints, migrations, tests, gaps.

## Resuming after a usage limit or a context reset

1. `git -C ~/project/aarogyam worktree list` shows the packages in progress. Each worktree's `git log main..HEAD` is what has been done.
2. Continue an interrupted agent by message if this session still has it; otherwise start a new agent with that package's row above plus "continue from the commits already on the branch".
3. Merge finished branches into `main` in package order (M2, M3, M4, M5). Then run `scripts/sqlx-prepare.sh` against a freshly migrated `aarogyam_dev`, the full gate, and push.
