# Handoff

Where the work stands and exactly what to do next. Update this file at the end of every working session. Read it, `delivery-plan.md` and `decisions.md` before starting.

## Status at 10 Oct 2026 (read this first)

**Backend plan for 8–10 Oct is complete and on `main`.** Every task passed the full pre-commit hook, including the database tests.
- notifications
- appointments: clinic hours, duplicates, check-in, consent notices, `may_contact`
- platform: support grants, dental terms, patient sessions, erasure
- labs, plus the follow-up (item edits, contact log)
- staff chat
- messaging core
- integration
- WhatsApp: off until `ARO_WHATSAPP__*` is set; see `docs/whatsapp.md`
- campaigns
- T7, the mobile API asks

**Deployed** on Cloud Run: `93fbe08`, migrations through 0392. **Not deployed yet:** 0364 onward from the later merges (0364, 0375–0377, 0380–0387, 0395–0397). Run `scripts/cloud-run-deploy.sh --yes` to apply them.

**UI not built:** the founder paused UI and app work. Every feature above is API only. The native v7 mobile session (`wt-mobile-v7`) consumes it.

**API for the mobile session (T7, paths under `/api/v1`):**
- `supersedes_id` on a new chart entry
- `room_id` on `POST /queue/{id}/status` with `in_chair`
- an `Idempotency-Key` header on `POST /expenses`
- `PUT` / `DELETE /me/avatar`, with `avatar` on `/session`, `/me` and `/staff`, and `GET /avatars/{id}/content?token=`
- analytics `patients.sex`, `procedures_by_category`, `chair_time {treatment, consult, admin}` (admin is always 0 until there's an admin appointment kind), `visit_sources {booked, walk_in}`
- `POST` / `GET /patients/{id}/record-shares`, plus the public `/shared/{token}/records`
- `GET /invoices/{id}/upi-link`

Exact schemas are in `docs/api/openapi.json`.

**Config to set when ready:**
- `ARO_EMAIL__RESEND_WEBHOOK_SECRET`: bounces and unsubscribes
- `ARO_WHATSAPP__*`: WhatsApp
- `ARO_CAMPAIGNS__ENABLED`: the kill switch, default true

**Known follow-ups:**
- the count token is a plain hash; key it later
- record-share revoke
- avatars on chat members and practitioners
- the chat retention purge
- clinical-content erasure

## Status at 8 Oct 2026, night (read this first)

**Live** (Cloud Run `b4e1971`, Workers on the same `main`, Supabase migrated through 0310):
- **Portal:**
  - the rail and page transitions
  - Settings tabs
  - Analytics with Billing → Expenses
  - one-step walk-ins: phone lookup, then patient-reported allergies, then consent, then a token
  - Start visit from the queue
  - note quick picks, Same as last visit, medicine sets, Complete and bill
  - fixes from two outside UI reviews: search by name parts and phone endings, query strings, Team today, missing details, polish
- **Staff phone app** (on `main`, no store build): walk-in, the Queue tab, Marathi and Hindi screens.
- **Demo data:** Sunrise's night-time rows were moved into clinic hours (`scripts/demo-refresh.sh --clinic-hours`).

**Founder's ask (8 Oct):** finish every backlog item that code alone can finish, **backend and e2e only: no app or UI development** (portal, console and phone screens wait). The UI parts of the tracks below stay in the backlog.

| Session | Track | Items |
|---|---|---|
| 1 | A: clinic notifications | Feed for every member who handles appointments; per-person read state and "handled by"; portal bell; inbox message; reminder then escalation to the owner; per-clinic "confirm online bookings automatically / wait for confirmation"; patient sees "the clinic will confirm"; in-app list on the phone (push waits for the founder's Firebase project and Apple key) |
| 1 | B: appointments | Appointment window redesign (one edit form, contact details, unsaved-edit guard, alignment; supersedes Codex tasks aro-no3, aro-7kc, aro-7j4); online sign-ups completed at Mark arrived; duplicate check by phone; clinic opening hours (used by chair utilization) |
| 1 | C: platform | Support grants (`support_grants`, owner grants time-limited audited access, console UI); consent drives messaging (withdrawn reminders or promotional consent stops those messages); clinic notice text with versions; retiring and renaming a clinic's own dental terms |
| 2 | D: e2e | Extend the Playwright golden journey: walk-in → queue → start visit → note → complete and bill; online booking → notification → confirm; expenses and analytics; settings tabs; run against the local stack |
| 2 | E: clinic group | One admin doctor across several clinics (clinic group, cross-clinic invitations underneath) |
| 2 | F: data | Erasure and anonymisation job; opening balances import; keep the original import file; patient session registry; throttled patient self sign-up (Turnstile) |
| 2 | G: notes and speech | Note original text and confirmed English (C3 API), phone dictation and ML Kit translation (C1–C2), Marathi/Hindi i18n layer for the portal (C4 web) |
| 2 | H: web | Single loader on sign-in, auth pages in the public site's look, date and time pickers in `sakalya-web` |

**Added 8 Oct (reviewed plan, backend only):** labs, staff chat and patient messaging. The full plan, with an independent review folded in, is at `~/.claude/plans/parallel-wibbling-thacker.md`.

| Task | What | Depends on | Migrations |
|---|---|---|---|
| R1–R3 | Finish notifications (0320), appointments plus `app.may_contact` (0330s), platform: support grants, dental terms, patient sessions, erasure (0340s) | — | 0320–0359 |
| T1 | **Labs:** vendors, contacts, orders with items, stages and rework, scopes, payments booked as lab expenses, reminder emails, attachments link, turnaround | `main` | 0360–0363 |
| T2 | **Staff chat:** `chat.use`, direct and group conversations, membership RLS, cursor polling, unread counts, `/me/badges` | `main` | 0390–0392 |
| T3 | **Messaging core:** `contact_preferences`, the `messages` queue, `messages_claim`, `message_dispatch`, send-time consent checks, quiet hours, email budget, direct messages, unsubscribe, Resend webhook, appointment reminders, existing patient emails moved off the outbox | R2 | 0370–0374 |
| T4 | **WhatsApp:** templates, Meta Cloud API adapter (off until credentials), HMAC webhook, STOP handling, `docs/whatsapp.md` (shared Sakalya number for the pilot) | T3 | 0375–0377 |
| T5 | **Campaigns:** audiences, count token, batched fan-out, frequency and daily caps, kill switch | T3 | 0380–0383 |
| T6 | **Integration:** lab overdue alerts on the notifications feed, erasure registration, support exclusion for chat, retention check | all of the above | 0395–0399 |
**Backend built on `feat/appointments-backend` (not merged; migrations 0330–0333):** clinic opening hours (`/clinic-hours`) used by chair utilization; appointment edit tests (the chair bug is in the portal, which sends the chair only with Move appointment); phone-duplicate flags, merge and dismiss (`/patient-duplicates`, `/patients/{id}/merge`), `registration_incomplete` and `POST /appointments/{id}/check-in`; clinic notice versions (`/consent-notices`); `app.may_contact` with the consent matrix. TS client regenerated. Their portal screens wait (see `backlog.md`).

**Needs someone outside these sessions:**
- WhatsApp and SMS (Meta templates, DLT, paid provider)
- phone OTP
- push credentials
- an AI provider with a data processing agreement, for paper import
- lawyer review of the legal pages
- native-speaker review of the Marathi and Hindi strings
- ABDM
- pharmacies and the referral programme (pricing)
- content for other specialties

**Codex queue:** paused, because the OpenRouter key hit its $10 limit. Tiers 2 and 3 now default to `google/gemini-3.8-flash`.

**Migration numbers:** Track A uses 0320–0329, B 0330–0339, C 0340–0359.

## Status at 4 Oct 2026, 13:30 PDT (read this first)

**Built and on `main` (not pushed):** M2–M5 backend (front desk, visits, prescriptions, billing), onboarding (registration → console approval → owner invitation email), portal screens for Today, patients, calendar and booking, queue, visit and dental chart, billing and collections, prescriptions with print, QR and PIN share; landing page and registration; console Applications, Clinic detail and Invite. Operator commands `aarogyam platform grant | revoke | list`, `aarogyam admin add-member` and `aarogyam outbox drain [--every N]`. The pre-commit hook runs the Rust gate and, for web changes, `pnpm check`.

**Demo (running on the founder's Mac; synthetic data only):**
- Database: Supabase (all migrations, seeded with Sunrise and Lotus). Local development keeps its own `aarogyam_dev`.
- `scripts/demo-api.sh` runs the API on 127.0.0.1:8095 plus the outbox sender (Resend, `noreply@aarogyam.sakalyatechnologies.com`, domain verified). `cloudflared` quick tunnel → `scratchpad/tunnel-url.txt`.
- Workers: `aarogyam-portal` (landing, sign-in, register; the API's app host), `aarogyam-console`, and one small forwarding Worker per clinic, `<slug>-aarogyam.spring-snow-130f.workers.dev`, created automatically by the outbox job when a clinic is created or approved (`scripts/provision-hosts.sh` backfills; docs/deploy.md "Clinic addresses").
- The founder signs in by email code; platform owner and Sunrise owner.

**Merged on 4 Oct afternoon (all gates green: Rust incl. database tests, 166 web tests):**
- Portal matches the founder's mock-up: shell, theme (`components/mk/`, `mockup.css`, brand colour still applies), Today, Calendar, Billing, Messages, Settings, Patients list and Patient 360 header.
- Clinical screens: allergies edit, note addenda, treatment plans (item status via `PATCH /treatment-plan-items/{id}`), record from the dental chart, Patient 360 bills and prescriptions.
- Patient summary fields (next appointment, balance, lifetime paid, recall due) and list filters (with balance, recalls due, new this month).
- Inventory M6 (migrations 0060–0061, `/suppliers`, `/inventory-items`, `/stock/*`, Stock tab). Low stock is a separate `low_stock` block on `/today`.
- Quality: `GET /console/quality`, console Quality page, `scripts/quality-run.sh local`, Playwright golden journey (`pnpm e2e`); 3 of 5 journeys pass, flaky ones vary by run.
- **Security fix:** sqlx could return a pooled connection mid-transaction as `app_user` with another request's tenant after a cancelled `begin_scoped`. `sakalya-db` v0.2.1 checks every released connection and closes dirty ones; Aarogyam pins v0.2.1. **Push the `v0.2.1` tag of sakalya-backend before anyone else builds.**
- `Member` schema clash fixed (`MemberRef`); a test fails on duplicate schema names.

**Merged on 4 Oct evening:** prescription link emailed on issue (no PIN or clinical data in the email; PIN shown to the doctor and printed); patient self-booking P1 (`/book` on each clinic host, `GET /public/availability`, `POST /public/bookings`, `requested` status with Confirm/Decline on the calendar, online-booking settings; migrations 0090–0091); Patients/Visits on the mock-up components, row click, Follow-up prefill. Design and the founder's decisions: `docs/patient-access.md` (next: P2 patient accounts and history). Self-booking gaps: Turnstile, patient cancellation, online booking defaults to on.

**Merged on 4 Oct night:** calendar time grid (Day/Week/Month, overlaps side by side) and scrollable Today timeline; voice notes 1A (recording + browser dictation, migration 0120); letterhead (upload or 6 designs, doctor qualifications, migration 0100), standalone patient prescription page, 7 theme palettes; clinic website templates and editor (`web/packages/site-kit`, `web/apps/site`, migrations 0110–0111; publishing and domains need the product domain); console Service health line charts, richer Quality, Applications and Clinics; sign-in and registration redesign (`AuthShell`). Gates: 371 web and 245 Rust tests. Running: speed work (`perf/round-trips`).
**First-run setup (merged 4 Oct night):** `/setup` is a five-step wizard for the clinic owner (your clinic; hours and doctors with split shifts; look; services and fees from a specialty starter list; team and patients), every step skippable and saved per step, resumable from a "Finish setting up" card on Today until done or dismissed; invited doctors get a one-screen version (name, qualifications, registration number, hours). Backend: migration 0130 (`clinic_setup`, `member_setup`; clinics and members that existed are marked dismissed), `GET/PATCH /settings/onboarding` (`settings.manage`), `GET/PATCH /me/onboarding`, `GET/PATCH /me/practitioner`, `GET/PUT /me/working-hours` (own record, no permission beyond membership; a member who can issue prescriptions gets a doctor record on first save), `specialty` added to clinic settings. Not built: a doctor's signature image for prescriptions (needs storage and a column), a clinic-level hours table (the wizard applies the hours to each doctor), a Settings tab deep link for "Website".

**Open:**
| Work | Where | State |
|---|---|---|
| Patients/Visits on mock-up components, row click, Follow-up prefill, Mark done without visit, `randomUUID` fallback | `../wt-polish`, `feat/portal-polish` | agent running at 17:00 |
| Move generic code to `sakalya-backend` v0.3 / `sakalya-web` | `../wt-refactor` | barely started; restart fresh |
| Playwright flakiness (2 of 5 journeys) | `web/e2e` | investigate |
| Mock-up elements without backend: ratings, sparklines, AI brief/scribe, messages KPIs/templates/campaigns, payouts, notification/website settings, month calendar, chair utilisation, purchase orders | — | product decisions |

**Decision waiting on the founder:** move `sakalyatechnologies.com` DNS to Cloudflare's free plan (GoDaddy stays registrar) for `<slug>-aarogyam.sakalyatechnologies.com` behind one wildcard route; until then clinic Workers on workers.dev are made automatically (docs/decisions.md, "Automatic clinic addresses").

**Fallback models:** `docs/fallback-agent.md` (rules) and `docs/fallback-tasks.md` (queue). Claude reviews `fallback/*` branches and merges.

## Status at 3 Oct 2026, evening (history)

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
  - Web (`web/`), working end to end against the API (`VITE_API_MODE=http`, types generated from `docs/api/openapi.json`): Sakalya console (dev or email-code sign-in, Service health with live metrics, Clinics, Create clinic with the owner's invite link) and clinic portal (sign-in, clinic switcher, patients list, search, Patient 360, New patient, accept invitation). A live test (`VITE_LIVE=1 pnpm vitest run --project portal live`) drives both against the running API.
  - Invitations: `POST /api/v1/invitations/accept`, tied to the verified sign-in email and the clinic, single use, 7-day expiry.

### Supabase (staging project, 4 Oct 00:45)

- Project on the free plan in Mumbai, Postgres 17.11. Data API off, sign-ups off, email OTP template set. The founder is added as a user.
- `.env.supabase` (git-ignored) holds the session-pooler owner URL, project URL and publishable key. Connect with `sslmode=verify-full&sslrootcert=config/supabase-ca.crt` (Supabase's public root CA, committed).
- All 17 migrations applied there as Supabase's non-superuser `postgres`; the schema lint passes and `anon`/`authenticated` hold no grants. Data stays local; Supabase is used for sign-in next.
- Still to do: set `aarogyam_api`'s password there; bootstrap the founder's Supabase user as platform owner in the local database with `aarogyam platform grant` (README). The local API accepts Supabase tokens alongside dev tokens (`ARO_AUTH__MODE=supabase`, `auth.dev_tokens`).

## Next steps, in order

1. **Invitation email:** the console shows the owner's invite link (`/invite#<token>`, accepted by `POST /api/v1/invitations/accept`, tied to the verified email); next, the outbox sends it by email (Resend) instead of copy-and-paste.
2. **Portal gaps:** Today needs a `/today` endpoint (M3); the console's Clinic detail and Quality pages; a separate audited "reveal contact" call in Patient 360.
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

Demo data ages: `scripts/demo-refresh.sh` (dry run; `--apply` to change; `--exact` shifts by exact days, not whole weeks) moves the demo clinics' (sunrise, lotus, suhasyadental) dated rows forward to today, as the owner, never deleting.
On Supabase: `set -a; . ./.env.supabase; set +a; scripts/demo-refresh.sh --apply` (reads `DB_OWNER_URL`); a shift of 0 days is a no-op, so it is safe to run daily.

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
