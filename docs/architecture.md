# Architecture

## Components

| Component | Tech | Runs on |
|---|---|---|
| API | Rust, Axum, `sakalya-*` crates | Cloud Run, Mumbai |
| Worker (notifications, transcription, exports, website builds) | Rust, Postgres queue | Cloud Run, Mumbai |
| Database, sign-in, files | Postgres 17, Supabase Auth, Supabase Storage | Supabase, Mumbai |
| Clinic portal, console | TypeScript, React (UI comes later) | Cloudflare |
| Clinic apps | Kotlin Multiplatform shared logic, Compose (Android), SwiftUI (iOS) | Stores |
| Clinic websites | Astro, one repository per clinic, built automatically | Cloudflare |

## Repository layout

```
aarogyam/
  crates/
    aarogyam-domain/      business types and rules, pure, no I/O
    aarogyam-dal/         SQL queries and row mapping (sqlx, compile-time checked)
    aarogyam-app/         use cases: load, decide, save, emit events
    aarogyam-api/         Axum routes, permission extractors, OpenAPI
    aarogyam-notify/      notification rules, templates, channels, outbox worker
    aarogyam-server/      binary: config, telemetry, wiring
  db/migrations/         SQL migrations, append-only
  db/seed/               synthetic clinics, patients and visits
  contracts/openapi.json generated from the API, committed
  specialties/           module definitions as data
  mobile/                Kotlin Multiplatform shared module, Android and iOS apps
  web/                   portal and console
  infra/                 OpenTofu for Google Cloud, Supabase, Cloudflare
```

Crates split further by module (patients, appointments, billing) only when build times or ownership call for it.

## A request, end to end

1. Cloudflare receives `https://smilecatchers.aarogyam.example/api/v1/patients/SC-1042` and forwards it to Cloud Run.
2. `sakalya-http` assigns a request ID and opens the request span.
3. Auth middleware verifies the JWT (`sakalya-auth`), checks the session is still active, and records `user_id` on the span.
4. Tenancy middleware resolves `smilecatchers` to a clinic, checks the user's membership, and records `tenant_id`.
5. The route's permission extractor checks `patients.read` against the membership's role, then the plan and feature flags.
6. The handler calls a use case in `aarogyam-app`, which opens a `ClinicTx` (scoped transaction), so row-level security limits every query to this clinic.
7. Reading a patient chart writes an `access_log` row. Changes write `audit_events` rows through triggers.
8. Errors become `ApiError` responses; the client gets a code, a message and the request ID header.

## Environments

| | Local | Staging | Production |
|---|---|---|---|
| API | `localhost:8080` | project `sakalya-clinic-staging` | project `sakalya-clinic-prod` |
| Clinic hosts | `smilecatchers.localtest.me:8080` | `*.aarogyam-staging.example`, or `workers.dev` with the clinic in the path until a domain is bought | `*.aarogyam.example` |
| Database | local Postgres | Supabase free project | Supabase Pro project |
| Data | seeded fakes | synthetic | real |
| Logs | pretty, `debug` | Cloud Logging, `info,aarogyam=debug` | Cloud Logging, `info`; per-clinic debug for 30 minutes on demand |

`localtest.me` and its subdomains resolve to `127.0.0.1`, so host-based tenancy works locally without editing `/etc/hosts`.

Domains are not chosen yet, so docs use the reserved placeholder `aarogyam.example`. Until a domain exists, staging runs on free `workers.dev` and `run.app` addresses, and a non-production setting may read the clinic from the URL path. Production only ever reads it from the host name.

## Cloudflare

One Cloudflare account for all Sakalya products, owned by the company identity, with members using their own logins. Each product has its own zones (domains). CI deploy tokens are limited to one product's zones.

Cloudflare stays a thin edge. Business logic lives in the Rust API on Cloud Run, which keeps it portable and avoids lock-in.

| Use | For | Cost |
|---|---|---|
| Workers with static assets | Clinic portal, console, clinic websites; a small proxy sends `/api/*` to Cloud Run | Free plan: 100,000 Worker requests a day. Requests served purely from static files don't run Worker code. Paid plan $5/month for 10M requests, when the API proxy needs it. |
| DNS, TLS, attack protection, firewall rules | Every zone | Free |
| Cloudflare for SaaS | Clinics' own domains (`www.smilecatchers.in`) | First 100 free, then $0.10 each per month |
| Access | The super admin console | Free up to 50 users |
| Turnstile | Bot checks on booking forms and OTP requests | Free |
| Web Analytics | Clinic website traffic, no cookies | Free |
| R2 | Public website images only (no download fees) | Free up to 10 GB; needs a card on file |
| Email Routing | `admin@` and support addresses to existing inboxes | Free |

**Not used, on purpose:**
- D1, KV, Durable Objects, Queues and Hyperdrive: Postgres and the Rust worker already do these jobs.
- Workers AI and Images: paid, and not needed.
- Argo, Load Balancing and Stream: paid add-ons.

Patient files never go to R2. They stay in Mumbai.

**Patient data at the edge:** API traffic passes through Cloudflare's network encrypted and is never cached. Cache rules exclude `/api/*`, and responses carry `Cache-Control: no-store`. Data is stored only in Mumbai. Cloudflare's regional TLS termination is an Enterprise feature; revisit it if a large customer requires in-country termination.
