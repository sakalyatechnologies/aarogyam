# Handoff

Where the work stands and exactly what to do next. Update this file at the end of every working session. Read it, `delivery-plan.md` and `decisions.md` before starting.

## Status at 3 Oct 2026, 15:20 PDT

Paused because the founder hit their usage limit (resets 19:10 PDT). Everything listed as done is committed and pushed to `main` in all three repositories.

### Done

- **Reviews:** three independent principal reviews (strategy and cost, library code, database), kept in `docs/reviews/2026-10-03/`, plus the MyDwarpal study (`lessons-from-mydwarpal.md`). Outcomes are in `decisions.md` (entry "Fourth review") and `delivery-plan.md`.
- **`sakalya-backend` (main, not yet tagged):**
  - `sakalya-db`: scope set in one round trip without prepared statements; `Db::scoped(&scope, async |tx| …)` commits or awaits the rollback; statement and idle-in-transaction timeouts; request ID and actor kind in `Scope`; SQLSTATE error kinds; TLS `verify-full` by default (`prefer` for localhost); tests run as a NOINHERIT login, not a superuser.
  - `sakalya-types`: sqlx encode/decode for `Id`, `Paise`, `Slug` and `PhoneE164` (feature `sqlx`); deserialising from owned strings; Indian landline and toll-free numbers.
  - `sakalya-http`: edge layer (`EdgeConfig`, `Edge` extractor) that trusts `X-Forwarded-Host` and `cf-connecting-ip` only with the edge secret; `ApiJson`/`ApiQuery`/`ApiPath` that never echo input; JSON bodies for 503 and 413; UUID-only request IDs; `no-store` and `nosniff`; sub-second timeouts fixed.
  - `sakalya-auth`: single-flight JWKS refresh with `prefetch()`; anonymous sessions and roles other than `authenticated` rejected; tests for nbf, leeway, kid and algorithm mismatch.
  - `sakalya-testkit`: JWKS server that counts fetches, fails on demand and rotates keys; Supabase-shaped test tokens.
- **`sakalya-web` (main):** form kit (accessible fields, phone input) and `DataTable`.
- **`aarogyam` (main):**
  - Docs: schema conventions, database roles, trust boundaries, CI/CD parked, delivery plan, lessons from MyDwarpal.
  - `db/migrations/0001–0013`: schemas, roles, settings helpers, row guards, change history, users/devices/sessions, clinics, permissions and roles, memberships, invitations, numbering, access record, pre-clinic lookups, patients, platform users and console functions. Verified as a Supabase-shaped non-superuser owner.
  - `db/checks/schema_lint.sql`: 15 rules, proven to catch violations.
  - `db/seed/local.sql`, `scripts/dev-db.sh`, `scripts/sqlx-prepare.sh`.
  - Cargo workspace: `aarogyam-domain` (permissions, admission rules, patient values, search parsing; 16 unit tests), `aarogyam-dal` (lookups, patients, console; queries checked at compile time against `.sqlx/`), `aarogyam-api` (router, health, OpenAPI snapshot test), `aarogyam-server` (`migrate`, `serve`).

### Paused work in worktrees (resume or redo)

| Worktree (under `~/project/`) | Branch | State | Left to do |
|---|---|---|---|
| `wt-backend-edge` | `fix/auth-http-throttle` | Merged except the throttle work; 1 commit and uncommitted changes ahead | Throttle: client IP only from `Edge`, IPv6 /64, shared bucket when no IP; Postgres store in `private` schema, unlogged, HMAC keys, one batched statement per request; memory store default, Postgres per rule; match on `MatchedPath`; split pre-auth and post-auth layers; bypass header only when edge-verified (review items R2-01, R2-02, R2-12, R2-25). Then merge. |
| `wt-web-kit` | `feat/portal-kit` | Form kit and DataTable merged into `sakalya-web` main | Dialog, Drawer, Menu, Toast themed in portals; status text tokens meeting AA (R2-17); BarChart legend colours (R2-18); AppShell mobile navigation, focus ring, skip link, router link prop (R2-19); `parseTheme` and validated CSS output (R2-27); gallery pages; axe tests. |
| `wt-aarogyam-web` | `feat/web-apps` | Wrapping up: console (dev sign-in, Service health on sample data) | Merge into `main`; then portal pages; then switch both apps from sample data to the local API. |
| `wt-aarogyam-metrics` | `feat/service-metrics` | Not started | Build the in-process metrics collector (spec below) or delete the worktree. |
| `wt-backend-db` | `fix/db-types` | Fully merged | Delete: `git -C ~/project/sakalya-backend worktree remove ../wt-backend-db`. |

## Next steps, in order

1. **Merge the web apps branch** (`feat/web-apps`) into `aarogyam` main after `pnpm check` passes there.
2. **API pipeline** in `aarogyam-api` (with `aarogyam-app` use cases):
   - Config: `auth.mode = "dev" | "supabase"`. Dev uses `JwtVerifier::shared_secret` with a local secret and a `POST /api/v1/dev/token {auth_uid}` route that exists only when `environment = local` (a test proves it is absent otherwise). Supabase uses `JwtVerifier::remote` and `prefetch()` at startup.
   - `HttpConfig::with_edge(EdgeConfig)` when an edge secret is configured.
   - Extractors:
     - `ClinicRequest`: `Edge` host → `resolve_host` (cache about 30 s) → bearer token → `authorize` (cache 30 s by clinic, `auth_uid` and session) → `ClinicActor::admit`. Answers: unknown host 404, no token 401, not a member 404, revoked 401.
     - `Require<P: Required>` wraps it and returns 403 for a missing permission.
     - `PlatformRequest`: console host plus `platform_access`.
     - `SignedIn` for the neutral host.
   - Record tenant and user on the span (`sakalya_telemetry::record_tenant`, `record_user`).
   - Clinic transactions: `db.scoped(&Scope::tenant(clinic).with_user(user).with_request_id(id).with_actor_kind(STAFF), async |tx| …)`.
   - Routes:
     - `GET /api/v1/me` (clinics via `my_clinics`), `GET /api/v1/session`.
     - Patients: `GET /api/v1/patients?q=` (classify with `PatientQuery`; number, phone and name prefix, fuzzy fallback), `POST /api/v1/patients` (number from `next_number`, masked phone without `patients.contact`), `GET /api/v1/patients/{id}` (writes the access record).
     - Console: `GET /api/v1/console/clinics`, `POST /api/v1/console/clinics` (token: 32 random bytes, base64url; store the SHA-256 hex; portal host `<slug>.<portal domain>`), `GET /api/v1/console/metrics?range=1h|24h|7d`.
   - Metrics collector (in `aarogyam-api/src/metrics.rs`): per route template and status, a latency histogram (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000 ms, +inf), rings of 60 minutes and 168 hours, `snapshot(range)` in the console contract's `api` shape, an Axum middleware reading `MatchedPath`. The `db` section comes from `console::db_health`; `edge` is `null` until Cloudflare analytics is wired.
3. **Tests:**
   - Database tests that create a database owned by `aarogyam_owner`, migrate as the owner, connect as `aarogyam_api`, and run `db/checks/schema_lint.sql` as a Rust test.
   - The permission catalogue matches `Permission::ALL`; `next_number` under concurrency.
   - API tests:
     - same clinic 200; another clinic's patient 404; wrong host 404; no token 401;
     - missing permission 403; missing edge secret refused; console needs a platform role;
     - every route declares a permission (route audit).
4. **OpenAPI:** annotate every route, regenerate `docs/api/openapi.json`, generate the web client's types from it.
5. **Web on the real API:** `VITE_API_MODE=http`; dev sign-in calls `/api/v1/dev/token`; hosts `sunrise.localtest.me:5173` and the console host proxy `/api` to `localhost:8080` with the original host.
6. **Libraries:** finish the paused throttle and web-kit work, tag `sakalya-backend` v0.2.0, switch `aarogyam` from tag `v0.1.0` to `v0.2.0`, and re-lock without the local patch.
7. **Small fixes:**
   - workspace `rust-version` to 1.99 (sqlx 0.9 needs 1.94 or later);
   - read `PORT` for Cloud Run;
   - `is_synthetic` on `organizations` so canary clinics are excluded from every count;
   - TOTP MFA (`aal2`) required on console routes before the pilot.

## Running locally

```
cd ~/project/aarogyam
scripts/dev-db.sh                                  # Supabase-shaped owner + aarogyam_dev
cargo run -p aarogyam-server -- migrate            # as aarogyam_owner (config/local.toml)
scripts/dev-db.sh --seed                           # two fictional clinics + a Sakalya admin
cargo run -p aarogyam-server -- serve              # http://localhost:8080/healthz
```

Seeded people (dev tokens use `auth_uid` as `sub`):

| Person | `auth_uid` | Access |
|---|---|---|
| Asha Kulkarni | `a1a1a1a1-0000-4000-8000-000000000001` | owner, Sunrise Dental (`sunrise.localtest.me`) |
| Dr Dev Rao | `a1a1a1a1-0000-4000-8000-000000000002` | doctor at Sunrise, consultant at Lotus |
| Farah Shaikh | `a1a1a1a1-0000-4000-8000-000000000003` | front desk, Sunrise |
| Bina Joshi | `b1b1b1b1-0000-4000-8000-000000000001` | owner, Lotus Dental Care (`lotus.localtest.me`) |
| Sakalya Admin | `c1c1c1c1-0000-4000-8000-000000000001` | platform owner (console) |

## Things to know

- **Local library override:** `~/project/.cargo/config.toml` (not in any repo) patches the `sakalya-backend` git dependency to the local checkout and sets `net.git-fetch-with-cli`. `Cargo.lock` was resolved with it, so don't use `--locked` without it.
- **sqlx offline:** `.cargo/config.toml` in this repo sets `SQLX_OFFLINE=true`. After changing a `query!`, run `scripts/sqlx-prepare.sh` (needs the migrated `aarogyam_dev`) and commit `.sqlx/`.
- **Local roles:** `aarogyam_owner` (Supabase-shaped owner), `aarogyam_api` (API login), `app_user` and the stand-ins `anon`/`authenticated` exist cluster-wide. Library tests use their own `sakalya_test_*` roles.
- **The pre-commit hook is the gate** (CI is parked): fmt, clippy with warnings as errors, all tests including database tests, cargo-deny, cargo-machete, schema-docs check.
- **`whoami` workaround** in `aarogyam-dal`: sqlx 0.9.0 builds it without `std`; remove when sqlx fixes it.

## Waiting on the founder

- **Supabase:** a project in Mumbai under the company login, set up as in `lessons-from-mydwarpal.md` (Data API off, sign-ups off, OTP 6 digits for 10 minutes, ES256 keys, TOTP MFA). Send the project ref and anon key only.
- **Google Cloud:** free-trial project `sakalya-clinic-staging` with a budget alert; APIs Cloud Run, Artifact Registry, Cloud Build, Secret Manager (no container scanning).
- **Paperwork:** SMS DLT registration and Meta business verification (both take weeks); trademark search, then the domain; SPF, DKIM and DMARC for the company email.
- **Earlier open items:**
  - keep or undo the four invitations accepted by mistake on the Thek10patil account;
  - rotate the MyDwarpal secrets flagged earlier.
