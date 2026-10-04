# Handoff

Where the work stands and exactly what to do next. Update this file at the end of every working session. Read it, `delivery-plan.md` and `decisions.md` before starting.

## Status at 3 Oct 2026, evening

The walking skeleton runs end to end locally: Postgres (migrated as a Supabase-shaped owner, row-level security on every table) → Rust API (sign-in, clinic session, patients, Sakalya console with live service metrics) → the clinic portal and console web apps. Everything below is committed and pushed to `main` in all three repositories; no worktrees are left.

### Done

- **Reviews:** three independent principal reviews (`docs/reviews/2026-10-03/`) and the MyDwarpal study (`lessons-from-mydwarpal.md`); outcomes in `decisions.md` and `delivery-plan.md`.
- **`sakalya-backend` (main):** every review fix merged. `sakalya-db` (one-round-trip scoped transactions with timeouts, `Db::scoped`, SQLSTATE error kinds, TLS verify-full by default), `sakalya-types` (sqlx encoding, owned-string deserialising, Indian numbers), `sakalya-http` (edge layer and secret, `ApiJson`/`ApiQuery`/`ApiPath`, JSON 503/413, UUID request IDs, `no-store`/`nosniff`), `sakalya-auth` (single-flight JWKS, anonymous and wrong-role tokens rejected), `sakalya-throttle` (before- and after-auth layers, per-rule memory or Postgres counters with hashed keys, fail-closed Postgres rules), `sakalya-testkit` (counting/failing JWKS server). Not yet tagged.
- **`sakalya-web` (main):** form kit, `DataTable`, Dialog/Drawer/Menu/Toast themed in portals, Badge/Tabs/SearchInput/ErrorState, AA contrast for status colours, BarChart and AppShell fixes, `parseTheme`, axe accessibility tests, gallery pages.
- **`aarogyam` (main):**
  - 13 migrations, 15 schema lint rules, seed, `scripts/dev-db.sh`, `scripts/sqlx-prepare.sh`.
  - `aarogyam-domain` (permissions, admission rules, patient values, search parsing), `aarogyam-dal` (compile-checked queries), `aarogyam-app` (patients: register, search, open with the access record, session; console: list and create clinics with an owner invitation).
  - `aarogyam-api`: extractors `SignedIn`, `ClinicRequest`, `Require<P>`, `PlatformRequest`; routes `GET /api/v1/me`, `GET /api/v1/session`, `GET /api/v1/patients` (recent), `POST /api/v1/patients/search` (terms in the body, never the URL), `POST /api/v1/patients`, `GET /api/v1/patients/{id}`, `GET/POST /api/v1/console/clinics`, `GET /api/v1/console/metrics` (in-process API metrics + database health), `POST /api/v1/dev/token` (local only); per-IP throttling before any token check; OpenAPI committed at `docs/api/openapi.json`.
  - `aarogyam-server`: `auth.mode = dev` (refused outside local) or `supabase`; hosts; edge secret required outside local.
  - Tests: domain and app unit tests; database tests for clinic isolation, sign-in and host checks, permissions and contact masking, input errors that never echo values, the access record and change history, the staff-only console, and a route audit (every route needs a token; every clinic route checks a permission); offline router tests for health, request IDs, the edge secret, dev sign-in absent when deployed, and floods refused.
  - Web (`web/`): Sakalya console (dev or email-code sign-in, Service health, Clinics, Create clinic) and clinic portal (sign-in, clinic switcher, Today, Patients search, Patient 360, New patient) on fake data or the real API (`VITE_API_MODE=http`).

## Next steps, in order

1. **Web on the real API, verified in a browser** (being finished tonight): seeded people for dev sign-in, types generated from `docs/api/openapi.json`, Vite proxy keeping the Host header.
2. **Invitations:** `accept_invitation(token, auth_uid, verified email)` tied to the invited email and clinic; console shows the invite link; then the outbox sends it by email (Resend).
3. **Session registry and per-user throttling:** revoke sessions from the portal; `after_auth` throttle layer once identity is inserted by middleware; TOTP (`aal2`) required on console routes.
4. **Supabase staging (M2.5):** when the founder's project exists, apply migrations once as `postgres`, switch `auth.mode = supabase`, then the Cloud Run + Cloudflare Worker deploy via Cloud Build (`cicd.md`).
5. **Small fixes:** workspace `rust-version` 1.99; read `PORT`; `is_synthetic` on `organizations` for canary clinics; a separate audited "reveal contact" call in Patient 360; tag `sakalya-backend` v0.2.0 and depend on the tag (re-lock without the local patch); `DataTable pageSize={Infinity}` bug in `sakalya-web`.
6. **M3:** appointments (one per chair at a time), queue tokens, working hours, Today from real data, patient import from Excel/CSV.

## Running locally

```
cd ~/project/aarogyam
scripts/dev-db.sh                                  # Supabase-shaped owner + aarogyam_dev
cargo run -p aarogyam-server -- migrate            # as aarogyam_owner (config/local.toml)
scripts/dev-db.sh --seed                           # two fictional clinics + a Sakalya admin
cargo run -p aarogyam-server -- serve              # http://localhost:8080/healthz
```

Web apps against that API (another terminal; `../sakalya-web` cloned and `pnpm install`ed):

```
pnpm install
VITE_API_MODE=http pnpm dev:console     # http://console.localtest.me:5174 (sign in as Sakalya Admin)
VITE_API_MODE=http pnpm dev:portal      # http://sunrise.localtest.me:5173 (sign in as Asha, Dev or Farah)
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

- **Library versions:** `aarogyam` depends on `sakalya-backend` **v0.2.0** by tag, pinned in `Cargo.lock`; a fresh clone builds with `--locked` (checked). Cargo fetches the private repository with your git credentials when `~/.cargo/config.toml` (or `~/project/.cargo/config.toml`) sets `[net] git-fetch-with-cli = true`. To change a library and the product together, add a `[patch]` section there temporarily (commented example in `~/project/.cargo/config.toml`), then tag a new library version and drop the patch before committing the product's `Cargo.lock`.
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
