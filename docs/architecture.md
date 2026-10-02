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
arogyam/
  crates/
    arogyam-domain/      business types and rules, pure, no I/O
    arogyam-dal/         SQL queries and row mapping (sqlx, compile-time checked)
    arogyam-app/         use cases: load, decide, save, emit events
    arogyam-api/         Axum routes, permission extractors, OpenAPI
    arogyam-notify/      notification rules, templates, channels, outbox worker
    arogyam-server/      binary: config, telemetry, wiring
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

1. Cloudflare receives `https://smilecatchers.arogyam.app/api/v1/patients/SC-1042` and forwards it to Cloud Run.
2. `sakalya-http` assigns a request ID and opens the request span.
3. Auth middleware verifies the JWT (`sakalya-auth`), checks the session is still active, and records `user_id` on the span.
4. Tenancy middleware resolves `smilecatchers` to a clinic, checks the user's membership, and records `tenant_id`.
5. The route's permission extractor checks `patients.read` against the membership's role, then the plan and feature flags.
6. The handler calls a use case in `arogyam-app`, which opens a `ClinicTx` (scoped transaction), so row-level security limits every query to this clinic.
7. Reading a patient chart writes an `access_log` row. Changes write `audit_events` rows through triggers.
8. Errors become `ApiError` responses; the client gets a code, a message and the request ID header.

## Environments

| | Local | Staging | Production |
|---|---|---|---|
| API | `localhost:8080` | Cloud Run `arogyam-staging` | Cloud Run `arogyam-prod` |
| Clinic hosts | `smilecatchers.localtest.me:8080` | `*.arogyam-staging.app` (or path mode until a domain is bought) | `*.arogyam.app` |
| Database | local Postgres | Supabase free project | Supabase Pro project |
| Data | seeded fakes | synthetic | real |
| Logs | pretty terminal | Cloud Logging | Cloud Logging |

`localtest.me` and its subdomains resolve to `127.0.0.1`, so host-based tenancy works locally without editing `/etc/hosts`.
