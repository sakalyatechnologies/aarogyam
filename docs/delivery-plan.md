# Delivery plan

How Aarogyam gets built, in what order, and what is deliberately left for later. Decisions behind it are in `decisions.md`.

## Principles

1. **Product-led.** The golden clinic journey sets the order: patient → appointment → arrival → visit → dental chart → treatment → prescription → bill → payment → follow-up.
2. **Pull, don't push.** `sakalya-backend` and `sakalya-web` grow only when Aarogyam needs a generic piece.
3. **One reference module, then fan out.** Patients is the pattern; later modules are built by parallel agents, each in its own branch, merged when the gate passes.
4. **Contract first.** The OpenAPI spec is generated from the Rust API and committed; web and phone clients use it.
5. **Local first, zero spend.** Local Postgres shaped like Supabase; staging when there is something to show; production at the pilot.
6. **Done means done:** migration, row-level security, tests (unit, database, cross-clinic, permission audit), OpenAPI, docs, small commits.

## Milestones

| | Builds | Done when |
|---|---|---|
| **M1 Foundation** | Workspace, migrations (roles, change history, users, clinics, permissions, numbering, access record, lookups), schema lint, seed | Migrations pass the lint as a Supabase-shaped owner; isolation proven in tests |
| **M2 Request pipeline** | Edge trust, host → clinic, Supabase JWT, `authorize`, `ClinicTx`, typed permissions with a route audit, OpenAPI, console create-clinic, invitations | A clinic created through the API signs in on its subdomain; cross-clinic tests pass |
| **M2.5 Staging** | Supabase free project, Cloud Run, Cloudflare Worker, a wildcard staging domain, Cloud Build | The portal works end to end on staging at no cost |
| **M3 Front desk** | Patients (reference), patient import (Excel/CSV), appointments (one per chair at a time), queue tokens, working hours, Today | A clinic's existing patients are imported, booked, arrive and queue |
| **M4 Visit** | Visits, notes with addenda and conflicts, vitals, conditions, allergies, files, Dental pack as data, procedures, treatment plans | A full dental visit is recorded |
| **M5 Prescription and money** | Prescriptions (allergy check, Quick Rx, print with footer and QR, PIN links), bills (GST fields, numbering at issue), payments, follow-up, outbox via Cloud Scheduler | The whole journey works on the API |
| **M6 Pilot readiness** | Production, error tracking, synthetic journey checks, backups with a restore drill (built, not yet applied: `docs/ops.md`), domain, legal | Smile Catchers starts |

The web portal stays one slice behind the API. The doctor app starts after M3 and is online-first in 1A.

## Today (3 Oct 2026): walking skeleton

| Piece | State |
|---|---|
| Independent reviews and MyDwarpal study | Done |
| `sakalya-backend` and `sakalya-web` review fixes | Done, merged |
| Schema model, M1 migrations, schema lint, seed | Done |
| Request pipeline, patients and console API, dev sign-in, throttling, metrics | Done, tested on a real database |
| Clinic portal and Sakalya console | Done on fake data; switching to the real API |

## Queued: move generic code into the shared repositories

Next when there is bandwidth, after the 4 Oct demo. One planned pass, then `sakalya-backend` v0.3 and new `sakalya-web` packages, with Aarogyam switched to them.

| Generic piece, now in Aarogyam | Moves to |
|---|---|
| Email sending (Resend) and the outbox worker (`aarogyam-notify`) | `sakalya-backend`: `sakalya-notify` |
| Supabase Admin client (accounts for invitations) | `sakalya-auth` |
| Service-metrics collector, short-lived cache, one-time token helpers | `sakalya-http` / `sakalya-telemetry` |
| Development sign-in token issuer | `sakalya-testkit` / `sakalya-auth` |
| Supabase sign-in flow (code and link, callback page) | `sakalya-web`: `@sakalya/auth` |
| API client helpers (error shape, request IDs, idempotency keys) | `sakalya-web`: `@sakalya/api` |
| Fastlane, Maestro, mobile session handling (from MyDwarpal) | future `sakalya-android` / `sakalya-ios` |

## Review follow-ups scheduled later

| Item | When |
|---|---|
| Deploy pipeline fixes (migrations step, no canary, runtime account, Docker base, pinned actions) | M2.5 |
| Throttle rules wired with a Postgres store for sign-in and PIN attempts | M2 |
| Indexes for appointments, queue, invoices and timelines; encounter–patient consistency keys | With each slice (M3–M5) |
| Sync columns for device writes (`row_version`, commit-safe cursor) | Doctor app (after M3) |
| Immutability triggers for signed and issued records; invoice payment state derived | M4–M5 |
| GST fields (supplier and recipient snapshot, SAC per line, CGST/SGST, credit notes) | M5 |
| Share-link PIN attempts and lockout; QR verify token | M5 |
| Outbox claim function, retries and retention | M5 |
| Retention classes, anonymisation, notice and consent records (DPDP) | Before May 2027 |
| Support role with time-limited grants enforced in the database; pgaudit | Before the pilot |
| ABDM identifiers and consent artefacts | ABDM milestones |
| Web kit: accessibility checks in CI, i18n strings | Web track |
| Foundation tables pointing outside the foundation (`rooms`, `assets`, `drug_catalog`, …): star or defer each | With each slice |

## Long-lead items (not code)

Start now: SMS DLT registration, Meta business verification, trademark search then domain, DPIIT recognition, SPF/DKIM/DMARC for the company email, data processing agreement and privacy policy, pilot agreements with 3–5 clinics, and a check of how many free Supabase projects the chosen login already uses (limit 2).
