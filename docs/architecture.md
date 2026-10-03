# Architecture

## Components

| Component | Tech | Runs on |
|---|---|---|
| API | Rust, Axum, `sakalya-*` crates | Cloud Run, Mumbai |
| Worker (notifications, exports, website builds) | Rust, a Postgres outbox table; woken by Cloud Scheduler calling an internal endpoint, because Cloud Run gives no CPU between requests | Cloud Run, Mumbai |
| Database, sign-in, files | Postgres 17, Supabase Auth, Supabase Storage | Supabase, Mumbai |
| Clinic portal, console | TypeScript, React, `sakalya-web` components | Cloudflare |
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
  db/checks/             schema rules every migration must keep (run by the database tests)
  db/seed/               synthetic clinics and patients for local development
  docs/api/openapi.json  generated from the API, committed
  specialties/           module definitions as data
  mobile/                Kotlin Multiplatform shared module, Android and iOS apps
  web/apps/portal        clinic portal: owners, doctors, front desk
  web/apps/console       Sakalya super-admin console
  web/packages/          shared web code, such as the typed API client
  scripts/dev-db.sh      local Postgres shaped like Supabase
```

Crates split further by module (patients, appointments, billing) only when build times or ownership call for it.

## A request, end to end

1. Cloudflare receives `https://smilecatchers.aarogyam.example/api/v1/patients/…`. A small Worker forwards it to Cloud Run with the original host in `X-Forwarded-Host`, the client IP in `cf-connecting-ip`, and a secret edge header.
2. `sakalya-http` rejects requests without the edge secret (except `/healthz`), assigns a request ID, and opens the request span. Locally there is no edge: the real `Host` header is used.
3. `app.resolve_host` turns `smilecatchers.aarogyam.example` into a clinic (cached briefly). Unknown or unverified hosts get `404`.
4. `sakalya-auth` verifies the Supabase JWT (ES256 against cached keys) and rejects anonymous sessions.
5. `app.authorize` returns, in one round trip, the user, their membership and role in this clinic, the role's permissions, and whether the session was revoked (cached about 30 seconds). Not a member, suspended, or revoked: `404`/`403`.
6. The route's permission extractor (`Require<PatientsRead>`) checks the permission, then the plan and feature flags.
7. The handler calls a use case in `aarogyam-app`, which opens a `ClinicTx`: one statement starts the transaction, switches to `app_user` and sets the clinic, user and request ID, so row-level security limits every query to this clinic.
8. Reading a patient's record writes an access record row. Changes write the change history through triggers.
9. Errors become `ApiError` responses: a code, a message without patient data, and the request ID header.

## Trust boundaries

- **The edge.** The Cloud Run URL is public, so anyone could call it directly and fake the host or client IP. The API trusts `X-Forwarded-Host` and `cf-connecting-ip` only when the request carries the Worker's secret header; otherwise it refuses the request.
- **Clinic from the host only.** Never from a header the client controls, a path segment or the body. The phone apps first call the neutral host (`app.aarogyam.example/api/v1/me`) to list the user's clinics, then call that clinic's own host.
- **The database.** The API logs in as `aarogyam_api`, which can do nothing on its own: clinic data only inside a `ClinicTx` (as `app_user`, under row-level security), and before the clinic is known only the three lookup functions. Migrations run as the owner. See `data-model.md`.
- **The console** sits behind Cloudflare Access, and the API also checks the caller's platform role.
- **Background jobs.** Cloud Scheduler calls `/internal/…` endpoints with a Google-signed token; the worker claims outbox rows with `FOR UPDATE SKIP LOCKED`. The live queue screen polls with ETags instead of holding connections open.

## Database connections

- Through Supabase's pooler (Supavisor) in **session mode**: sqlx's prepared statements are safe there, and it works over IPv4, which Cloud Run uses. At most 5 connections per instance, and a cap on instances, keep within the free tier's pool.
- TLS with certificate verification (`verify-full` with Supabase's CA) everywhere except local.
- Timeouts on every transaction (statement and idle-in-transaction), so a request cut short on Cloud Run can't hold locks.
- Migrations run in session mode as the owner, from the `aarogyam migrate` command.

## Environments

| | Local | Staging | Production |
|---|---|---|---|
| API | `localhost:8080` | project `sakalya-clinic-staging` | project `sakalya-clinic-prod` |
| Clinic hosts | `sunrise.localtest.me:8080` (seeded) | a wildcard staging domain, chosen when staging is set up | `*.aarogyam.example` |
| Database | local Postgres | Supabase free project | Supabase Pro project |
| Data | seeded fakes | synthetic | real |
| Logs | pretty, `debug` | Cloud Logging, `info,aarogyam=debug` | Cloud Logging, `info`; per-clinic debug for 30 minutes on demand |

`localtest.me` and its subdomains resolve to `127.0.0.1`, so host-based tenancy works locally without editing `/etc/hosts`.

Domains are not chosen yet, so docs use the reserved placeholder `aarogyam.example`. Every environment reads the clinic from the host name; there is no path-based mode, so staging waits for a wildcard domain.

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
