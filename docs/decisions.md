# Decisions

Newest first. Change a decision by adding an entry that supersedes it.

## 2026-10-05: Central sign-in and the session handoff

- **People sign in once, on the public site** (`aarogyam.sakalyatechnologies.com/sign-in`). `/me` then decides: Sakalya staff to the console, one clinic to that clinic, several to a picker. Portals send signed-out visitors there with `?next=<host>` when `VITE_CENTRAL_SIGN_IN_URL` is set; their own sign-in keeps working until the site ships.
- **A session belongs to one origin, so it is handed over, not shared.** `POST /api/v1/auth/handoff {host}` (signed in) returns a random 32-byte code valid 60 seconds, bound to the person and that host, only for an active member of that open clinic or staff for the console (otherwise `404`). The browser goes to `https://<host>/auth/handoff#code=…`; the fragment never reaches a server or log. `POST /api/v1/auth/handoff/redeem {code}` on that host uses the code up on the first attempt, right or wrong, and answers with a Supabase magic-link token hash (`generate_link`, nothing emailed) that the page trades with `verifyOtp` for a session of its own; locally, a development token. Only the code's SHA-256 is stored (`auth_handoffs`, migration 0161); both steps are in the change history and logged as `handoff.*` events; redeem is throttled to 20 per IP per 10 minutes.
- **`/me` says `console_access`** for active Sakalya staff. Staff only: the console; staff with clinic memberships: the picker with "Sakalya console" first. **Super admin accounts should be separate from clinic accounts;** support access to a clinic goes through time-limited grants (planned).
- **Slugs stay readable.** The approve form checks the address as it is typed (`GET /api/v1/console/slugs`) and offers `<name>-<city>` or a three-character suffix when it is taken; the unique constraint has the final say.

## 2026-10-05: Automatic clinic addresses

**Problem.** The clinic comes from the host name, and workers.dev has no wildcard subdomains, so every clinic needed its own Worker (`<slug>-aarogyam.<account>.workers.dev`) deployed by hand. A clinic the founder had just created or approved had no address, so its owner couldn't sign in.

**Decided with the founder.** Addresses stay readable, host-based subdomains: `<slug>-aarogyam.spring-snow-130f.workers.dev` now, `<slug>-aarogyam.sakalyatechnologies.com` later, never UUIDs. Clinics' own domains map a host to the clinic id later (Cloudflare for SaaS).

| Option | Cost | Security | Founder must |
|---|---|---|---|
| **B1. Recommended: one portal Worker on a wildcard route, `sakalyatechnologies.com` nameservers moved to Cloudflare's free plan** (GoDaddy stays registrar) | $0. Universal SSL covers one level (`*.sakalyatechnologies.com`), so `<slug>-aarogyam.` works; `<slug>.aarogyam.` would need Advanced Certificate Manager ($10 a month) | No per-clinic API calls and no token in the backend. DNS for the whole company domain moves, so every record must be copied first | Follow the checklist in `deploy.md` ("Moving the domain to Cloudflare"): copy records, verify, switch nameservers, add the wildcard record and route |
| **A. Interim, built: a Worker per clinic through the Cloudflare API** | $0. Free plan allows 100 Workers per account, so about 95 clinics on workers.dev. Service bindings add no cost | The token ("Workers Scripts: Edit") can change any Worker in the account, so only the outbox job holds it, never the API service or a browser. Names come from a parsed `Slug` and must match the stored host. Platform Workers can't be overwritten | Create a dedicated token once; run the backfill once |
| **B2. B1 on a separate cheap domain** | About $10 a year (Cloudflare Registrar, at cost) | As B1, and the company domain's DNS is untouched | Buy the domain. Breaks "zero spend" |
| **C. Cloudflare for SaaS custom hostnames** | First 100 free | Each hostname is validated | Still needs a zone on Cloudflare, plus a CNAME per clinic in the hostname's own DNS (GoDaddy, by hand). Kept for clinics' own domains (`www.smilecatchers.in`), as planned |
| **D. DNS records through GoDaddy's API** | Since 2024 the production Management and DNS APIs need 10 or more domains in the account or a paid Discount Domain Club plan | A GoDaddy key could change every DNS record of the company | Pay or hold 10 domains. It doesn't solve the problem anyway: a GoDaddy CNAME to workers.dev isn't served, because Workers only answer hostnames in Cloudflare zones |

**Decision: B1 as the destination, A until the nameservers move.**

- **B1: a new clinic needs no deploy at all.** A proxied wildcard DNS record and a Worker route send every clinic host to the portal Worker, which already forwards the request's own host. The route `*-aarogyam.sakalyatechnologies.com/*` is safer than `*.sakalyatechnologies.com/*`: a route matches by host name whatever the DNS says, so the broad one would also catch other products' proxied subdomains. More specific routes win, so `console-aarogyam.sakalyatechnologies.com/*` goes to the console Worker and `aarogyam.sakalyatechnologies.com/*` to the public site. Explicit DNS records (mail, the company site, other products) keep overriding the wildcard record.
- **A is automatic today.** A new portal host is queued as `pending` by the database whatever path creates it (console, approved application, seed). The outbox job (`aarogyam outbox drain`, every 2 minutes) handles addresses before email, so the owner's invitation link works when it arrives. It uploads a tiny Worker named `{slug}-aarogyam` whose only job is to hand every request to `aarogyam-portal` through a service binding, then turns on its workers.dev address. Both calls are idempotent. Failures are retried with the outbox's backoff, then marked `failed` with a reason.
- **The clinic Worker holds no secret.** The portal Worker reads the clinic's host from the request URL, which only Cloudflare or our own bindings can set, and forwards it with the edge secret as before. A portal release reaches every clinic without redeploying anything.
- **Status lives on `org_domains`** (`edge_status`, migration 0160), not in the outbox. Outbox rows are messages and are purged after 30 days, but the console needs the status for good. The console shows "Address ready / pending / failed".
- **Moving from A to B1 needs no code or console change.** Set `ARO_EDGE__HOSTS=wildcard` (the job then marks hosts ready without calling Cloudflare) and `ARO_HOSTS__PORTAL_HOST_TEMPLATE={slug}-aarogyam.sakalyatechnologies.com`, re-point existing hosts, remove the job's Cloudflare token, and delete the per-clinic Workers.

## 2026-10-04: The visit record (M4)

- **Clinicians are memberships.** Visits, notes, procedures and plans point at `memberships`; a doctor's practitioner record (registration, fees) hangs off the same membership. `encounters.appointment_id` has no foreign key until the appointments table merges; a follow-up migration adds the composite key.
- **Final means frozen by trigger.** `app.freeze_when()` lets a signed note, a recorded reading, a chart entry or a done procedure only move to its allowed next status (entered in error, corrected, superseded); corrections are new rows. Every child of a visit carries `patient_id` with a composite key `(org_id, encounter_id, patient_id)`.
- **Only a note's author edits or signs it;** any clinician may add an addendum or mark a signed note entered in error with a reason.
- **Clinical flags need only `patients.read`:** everyone who can see the patient learns that flags exist and how many; substances and conditions need `clinical.read`.
- **Files are typed by their content** (JPEG, PNG, PDF, DICOM), stored at `<clinic>/<file>` behind a `Storage` trait (local disk in development, a private Supabase Storage bucket in the cloud), and served through five-minute HMAC links that write the access record.

## 2026-10-03: Fourth review (three independent principal engineers) and the build plan

Three reviewers checked strategy and cost, the library code, and the database design before coding (71 findings, 17 marked P0; full reports are summarised in `delivery-plan.md`). Decided with the founder:

- **Today's target is a walking skeleton:** libraries fixed, the M1 migrations, the full request pipeline and patients (create, read, search) with isolation tests, docs a senior engineer can onboard from. Invitations, the console API and staging come next.
- **CI/CD is parked.** Workflows run only by hand; the local pre-commit hook is the gate. When resumed, builds and deploys move to Google Cloud Build as in MyDwarpal, because GitHub Free has no environments, branch protection or approvals for private repositories. **All repositories stay private.**
- **Local Postgres first,** shaped like Supabase (a non-superuser owner). A Supabase project arrives with staging; migrations are tried on it once before then.
- **Database:** statuses are text with CHECK constraints, not enums (enums defeat indexes under row-level security). Tables in `aarogyam`, the change history and access record in `audit`, nothing in `public`, Supabase's Data API off. The API logs in as `aarogyam_api`, which can't read anything outside a clinic transaction; lookups before the clinic is known are three audited definer functions. Every table has a lifecycle. The change history stores changed columns only.
- **Change history and access record are records, not logs.** They stay in the database (same transaction as the change or read, queryable per patient), about 13 months hot, then archived to Cloud Storage. Application logs go to Cloud Logging.
- **Edge trust:** the API accepts the forwarded host and client IP only with Cloudflare's secret header. Phone apps call a neutral host for their clinic list, then the clinic's own host.
- **Connections:** Supabase's pooler in session mode (sqlx prepared statements are unsafe in transaction mode), TLS with certificate checks, timeouts on every transaction.
- **Prescription links in the pilot** open with a PIN printed on the prescription, sent from the clinic's own WhatsApp; OTP comes after DLT and Meta verification, which start now.
- **Doctor app in 1A is online-first:** a local read cache and a durable queue of drafts; phone dictation (free) plus recordings. No sync engine yet.
- **Appointments:** the hard rule is one appointment per chair at a time; a dentist double-booked across chairs gets a warning.
- **Plan changes:** a free staging deploy becomes M2.5; patient import from Excel/CSV joins M3; background jobs are triggered by Cloud Scheduler.
- **Web track started in parallel:** the shared UI kit gains forms, dialogs and a data table; the clinic portal and super-admin console run on sample data until the API serves them.

## 2026-10-03: Final review before freezing the foundation

A third review found the design ready to implement. Four small changes were applied:

- **Offline signing conflicts:** signed clinical records are never merged automatically. A change that collides with a note already signed on the server is kept as a separate note with status `conflict`, linked by `conflicts_with_id`. Its author resolves it by marking one version `entered_in_error` with a reason. "Latest change wins" applies only to non-clinical fields.
- **Share links** use typed, tenant-aware foreign keys (`prescription_id`, `invoice_id`, `attachment_id`) with a check constraint, instead of a generic resource id.
- **Branch access** moves from an array on `memberships` to a `membership_branches` table. No rows means every branch.
- **Consent purposes** are care, referral and insurance. Research consent is out of scope; adding it later needs its own decision and ethics review.

**Phase 1A scope is frozen,** and the web portal and doctor phone app ship together, as decided. The golden clinic journey is the hard build order, so each step works end to end before the next starts. New ideas go to 1B or Phase 2.

**Next:** freeze the foundation schema and write the first migrations.

## 2026-10-03: Cloudflare, domains and startup credits

**One Cloudflare account for all Sakalya products,** owned by the company identity, with each product in its own zones and teammates as members. The same rule applies to Google Cloud and Supabase: one company login, separate projects per product.

**Cloudflare stays thin:** static hosting, the `/api` proxy, DNS, attack protection, Cloudflare for SaaS, Access, Turnstile, Web Analytics, and R2 for public images only. No D1, KV, Durable Objects, Queues, Workers AI or paid add-ons. Architecture details are in `architecture.md`.

**Domain not chosen yet.** `aarogyam.com` (registered 2005), `aarogyam.in` (2012), `aarogyam.app` (2018), `aarogyam.co.in` and `aarogyam.org` are taken. Candidates still available on 3 Oct 2026: `aarogyam.health`, `aarogyam.care`, `aarogyam.clinic`, `aarogyam.io`, `getaarogyam.com`, `myaarogyam.com`, plus `aarogyam.dev` for staging. Long-held registrations signal trademark risk, so the IP India search comes before buying. Only one main domain is needed: clinic subdomains are free and unlimited under a wildcard record and certificate. Docs use `aarogyam.example` until then. Buy just before the first pilot.

**Startup credits are timed, not rushed.** Credits usually expire after 12 months.
- **Now:** a company-domain email and Startup India (DPIIT) recognition.
- **About a month before the pilot:** Cloudflare for Startups (bootstrapped tier, $5K, needs a company-domain email), Google for Startups Start ($2K) and Supabase (up to $3K).
- **As usage grows:** PostHog ($50K) and Sentry.

## 2026-10-03: The product is Aarogyam; permanent identifiers stay neutral

**Decision.** The product name is spelled **Aarogyam**. Identifiers that can never be renamed carry no brand: Google Cloud projects `sakalya-clinic-staging` and `sakalya-clinic-prod`, app IDs `com.sakalya.clinic` and `com.sakalya.patient`. Names that can change later (repositories, crates, services, UI text) use the brand.

**Why.** A future rename should only cost a find-and-replace, a repository rename and a domain redirect. App store IDs and cloud project IDs can never change.

## 2026-10-03: Gaps found against existing clinic software

**Added.**
- **Prescription safety:** an allergy check in Phase 1A. Drug interactions, contraindications, pregnancy and breastfeeding cautions, child dosing and precautions from a licensed drug database in Phase 2. Overrides are recorded with a reason (`prescription_alerts`).
- **Quick Rx:** repeat the last prescription and favourites per diagnosis (1A); AI suggestions later.
- **Phase 2 additions:**
  - Smart Scan (`document_extractions`, confirmed before use)
  - AI past-visit summaries
  - teleconsultation, moved from phase 4 (`teleconsult_sessions`)
  - a light patient page on share links
  - doctor-facing prescription analytics
- **Pricing hypotheses:** bundled message credits and support tiers per plan.

**Not adopted.** Diagnostic decision support (conflicts with "AI never diagnoses" and may be regulated as a medical device) and paid research on clinic data (a trust risk for a privacy-first product).

## 2026-10-03: Review outcomes (product brief and database)

Two independent reviews were checked against the repository; agreed points are recorded here.

**Phase 1 is split.** 1A: Aarogyam Core plus the Dental pack, web portal and doctor mobile experience, with 3 to 5 dental clinics (Smile Catchers first). 1B: General Medicine as the second pack, proving the Specialty Pack architecture before more specialties.

**Product boundaries.** Internally Aarogyam is Clinic OS (practice operations), Patient (the patient's own health record, phase 3) and Platform (identity, consent, notifications, payments, audit, integrations). Specialties are **Specialty Packs**: forms, schemas, views, dashboards, vocabulary and permissions as data on top of Core. Customers see one brand.

**Foundation = the golden clinic journey.** Patient, appointment, arrival, visit, dental chart, treatment, prescription, bill, payment, follow-up, with isolation and audit. Plans, subscriptions and feature flags arrive when pilots need them.

**Clinical data levels.** Patient-level (allergies, problem list, history, long-term medicines), episode-level (`care_episodes`, optional, built when a pack needs it), visit-level (complaint, vitals, notes, procedures, prescriptions) and specialty state (longitudinal `specialty_records` with status and supersession). Clinical codes are optional columns; free text always works. Important clinical rows record provenance (`source`, verified by).

**Immutability.** Signed notes take addenda; issued prescriptions are cancelled and reissued; issued bills are voided and replaced; observations are corrected by superseding rows. Readable numbers are assigned by the server at issue, never on a device.

**Offline and sensitivity are part of the model.** Every table is classified as read-write, read-only or server-only on devices, and by sensitivity (public, internal, personal, financial, health). Logging, export, analytics, support access and AI processing follow the classification.

**Identity.** A phone number is contact information, never identity. Cross-clinic linking needs verification (OTP, ABHA or clinic confirmation). Merges never move records and can be undone. The clinic owns its clinical record; the patient controls cross-clinic sharing.

**Access ledger and consent.** `access_log` records purpose and device as well as who, what and when. `consents` records purpose, data categories and source.

**Test results live outside the healthcare database.** CI, end-to-end and canary results go to a separate operations store (a BigQuery dataset, free tier); the super admin Quality page reads from there.

**Prescriptions.** Doctors and staff see every prescription in the patient's history and can print or reprint it on the clinic letterhead or plain paper (A4, A5 or thermal), with a small "Prescribed with Aarogyam" footer and a QR code that opens the verified copy. Higher plans may remove the footer later. Before the patient app, patients receive an expiring WhatsApp or SMS link that opens after a one-time code, backed by `share_links` and logged in the access ledger.

**Letterhead.** Every clinic document (prescription print, patient shared page, bill, receipt) renders under one clinic letterhead: either an image the clinic uploads (PNG or JPG, up to 2 MB, checked by content, kept in file storage under the clinic's folder and shown through signed one-hour links that need no sign-in) or one of six generated designs filled from clinic details, doctors (qualifications and registration numbers live on the practitioner, migration 0100), an accent colour, which details to show and a footer line. It is stored under `branding.letterhead` in `org_settings`, edited through `PATCH /settings/clinic`, read for printing at `GET /letterhead` (`patients.read`) and for a share link's page at `GET /shared/{token}/letterhead`. It holds no patient data. Settings, "Letterhead & theme", also switches the portal palette (shared presets in light or dark, or any brand colour) through the existing branding keys. The sheet, picker, preview and theme picker are product-neutral components marked `moves to sakalya-web`.

**Website.** Phase 1 links a clinic's existing website and adds booking. Phase 2 offers about five excellent templates (with the automated repository per clinic). AI-written copy comes later. Whether the website is a paid feature or a free acquisition hook is tested with pilots.

## 2026-10-03: Platform repositories are named by stack

**Decision.** `sakalya-platform` is renamed `sakalya-backend`, alongside the planned `sakalya-web`, `sakalya-android` and `sakalya-ios`. Crate names keep the `sakalya-` prefix.

## 2026-10-03: Clinics own their patient rows

**Decision.** Replace the shared `persons` table with clinic-owned `patients` rows. Cross-clinic views use `patient_links` (a patient's own account verified against each clinic's record) plus `consents`.

**Why.** With a shared person row, one clinic's edits to a name or phone number would show up at another clinic, and matching people automatically across clinics risks merging strangers. Under the DPDP Act each clinic is the data fiduciary for its own records, so each keeps its own copy, and the patient decides what is joined.

## 2026-10-02: Repositories

**Decision.** Three kinds of repository:

1. `sakalya-backend`: shared, product-agnostic Rust crates, depended on by git tag.
2. `aarogyam`: one monorepo for the whole product (API, worker, migrations, specialties, phone apps, web, infra).
3. One repository per clinic website, created automatically when a clinic publishes a site.

**Why.** MyDwarpal's four repositories drift apart: the mobile app hand-copies about 3,680 lines of backend types, and a review found 19 client calls with no matching route. In a monorepo an API change and its client updates land in one pull request, and agents see the whole contract. The platform repo stays separate because it must never learn product concepts, and a repository boundary enforces that. Clinic sites get their own repositories so each has a history and can be handed to the clinic.

| | Monorepo (chosen) | One repo per component (MyDwarpal today) |
|---|---|---|
| API and client changes | One pull request | Coordinated releases across repos |
| Shared types | Generated in place | Copied by hand or published as packages |
| Agents | See everything | See one side of each contract |
| CI | Path filters run only what changed | Simple per repo |
| Access control | Same for all code | Per repo |

## 2026-10-02: Stack

Rust backend (Axum, sqlx, Tokio), Kotlin Multiplatform for shared app logic, Jetpack Compose on Android, SwiftUI on iOS, TypeScript and React on the web. The founder knows Rust and will build mostly with agents; the compiler catches more of an agent's mistakes than any other mainstream language. Desk-heavy work goes on the web so fewer screens are built twice.

## 2026-10-02: Data and tenancy

PostgreSQL on Supabase (Mumbai). Shared schema with `org_id` and row-level security, enforced through `sakalya-db` scoped transactions. The clinic is resolved from the host name only.

## 2026-10-02: Spend nothing until real patients

Local Postgres for development, Supabase free for staging, Cloud Run's free tier, Cloudflare free, GitHub free, Sentry free. The first paid items are Supabase Pro ($25 a month) before real patient data, and domains when needed.

## 2026-10-02: Notifications as a service

One notification module owns every outbound message. Rules (birthdays, appointment reminders, recalls, health tips, promotions) create scheduled messages; a worker sends them through channels (WhatsApp, SMS, email, push, in-app) with consent checks, quiet hours, deduplication, retries and per-clinic cost metering.

## 2026-10-02: Automated clinic websites

Onboarding answers become a site configuration. A GitHub App creates the clinic's repository from a template, commits the configuration, and a shared workflow builds it with Astro and deploys to Cloudflare. Website repositories hold only public content, so they can be public and get free CI minutes.

## 2026-10-04: Front desk scheduling rules (M3)

- A chair is the hard limit: an exclusion constraint refuses two active (not cancelled, not no-show, not deleted) appointments overlapping in one room, answered as `409`. A doctor booked in two chairs at once, on leave or outside weekly hours is allowed with `warnings` (R3-11).
- Statuses are `booked`, `confirmed`, `arrived`, `in_chair`, `completed`, `cancelled`, `no_show`, moving only forward (`aarogyam_domain::schedule`); cancelling needs a reason. Kinds are `new`, `follow_up`, `procedure`, `emergency`. These replace the web draft's `scheduled`/`in_progress`/`teleconsult`.
- Arrival issues a queue token numbered per branch per clinic day from `number_sequences` (kind `queue_token`, series = branch, period = local date). Tokens are `waiting`, `in_chair`, `done` or `left`; moving a token moves its appointment.
- Chairs, doctors and weekly hours change with `settings.manage`; leave with `appointments.write`, because the front desk records it.
- Patient imports take CSV text (≤ 5,000 rows, ≤ 2 MB) with a column mapping; a preview saves nothing, a commit saves the valid rows in one transaction and records every row's result.

## Next milestone: foundation (golden clinic journey)

1. Cargo workspace with the six product crates, depending on `sakalya-backend`.
2. Migrations for the ★ tables in `data-model.md`, with RLS and policy tests.
3. Host-based tenancy, session check, typed permission extractors, route-permission audit test.
4. Patients module end to end as the reference for all other modules.
5. Deploy to staging on Cloud Run with Supabase free.

## 2026-10-05: Mobile architecture

**Decision.** Product-agnostic Kotlin Multiplatform libraries live in a new `sakalya-mobile` repository (core, http, auth, secure storage, outbox, design tokens and components for Compose and SwiftUI), replacing the planned `sakalya-android` and `sakalya-ios`. The Aarogyam apps live in `aarogyam/mobile` (shared KMP module with the generated API client and screen state holders, a Compose app, a SwiftUI app generated by XcodeGen). Tenancy stays host-based: the app calls each clinic's host. Online-first with a read cache and an outbox. Details: `docs/mobile-architecture.md`.

**Why.** Kotlin Multiplatform puts the logic in one tested place, so one repository serves both platforms; the API client is generated so it can't drift (MyDwarpal hand-copied types and enums). MyDwarpal's lessons are applied: secure token storage from day one, only a rejected refresh signs out, idempotency keys per submission, request IDs, small screens with logic in testable state holders.

## 2026-10-05: Optional password sign-in

**Decision.** The clinic portal and console keep the email code as the default and add an optional password (Supabase `signInWithPassword`, `updateUser({ password })`). A wrong password and an unknown email give one message. "Forgot password?" sends the email code, then offers a new password after sign-in. Passwords are at least 12 characters, never logged or stored by us. The API is unchanged: it only verifies Supabase JWTs (issuer, audience, signing keys), which look the same whichever way the person signed in. Sign-in attempts are throttled by Supabase Auth itself (per-IP and per-email limits on the token endpoint, plus the email-send limits that already cover codes); the screen shows the same "too many attempts" message for both.

**Founder must enable in Supabase (not done in code).** Authentication, Providers, Email: keep "Enable email provider" and password sign-in on; set minimum password length to 12 and require letters and digits; keep "Confirm email" on; consider "Leaked password protection" (Pro plan only). Review the Auth rate-limit page ("Rate limit for sign-ups and sign-ins" defaults to 30 per 5 minutes per IP).

**Follow-up (open, not built): require a second step for super admins.** A password alone is a weaker proof than a mailbox-held code for the console, which can see every clinic. Proposal: enrol super admins in Supabase TOTP MFA, have the API require `aal2` in the JWT (the claim is already parsed in `sakalya-auth`) on console routes, and make the console prompt for the authenticator code after either sign-in method. Until then, super admins should prefer the email code.

## 2026-10-05: Supabase Storage for files, streamed through the API

**Decision.** `ARO_FILES__BACKEND=supabase` keeps file bytes in a private bucket (`ARO_FILES__BUCKET`, default `aarogyam-files`) through Supabase's Storage REST API and the server key; `local` stays the default for development and tests. Downloads still go through our permission-checked route, which fetches the object and streams it. We do not redirect to a Supabase signed URL.

**Why.** The route already checks the permission, writes the access record and enforces the five-minute link. A redirect would hand the browser a second bearer URL that outlives our check and sits in browser history and proxy logs, and would need an extra Storage call to mint it. Streaming adds no database trip and one hop inside Supabase's network; files are capped at `MAX_BYTES`, so memory is bounded. Objects are named `<clinic id>/<attachment id>`, so no patient data is in a key, URL or log. Revisit with redirects if files grow large.

## 2026-10-06: Clinics edit their roles

**Decision.** A new `roles.manage` permission (owner only by default) lets a clinic change what each role may do (`PUT /api/v1/roles/{key}/permissions`), create custom roles from a standard role and remove unused ones. The owner role is never edited or removed, nobody edits their own role, and nobody grants a permission or a wider scope they don't hold (keeping what a role already has is not granting). Every change is one statement that also writes `role_changes` (who, before, after); the API forgets the cached permissions of everyone with the role, so it applies on their next request. Removed roles are soft-deleted so history and old invitations still point at them. Standard role defaults are unchanged: `finance.view` stays with owner and finance.

**Known gap (closed 2026-10-06, see "Permission scopes are enforced").** `own` and `assigned` scopes were stored and offered, but routes checked only whether a permission was held.

## 2026-10-06: Permission scopes are enforced

**Decision.** A permission held at `own` reaches only the member's own records; anything else is `404`, exactly like another clinic's record, in lists, search, counts, single reads and writes. The route's permission decides the scope (`ClinicActor::reach`), and each query takes the member as one nullable parameter (null at `all`) checked by SQL functions in its own `WHERE` (`app.patient_in_reach`, `app.clinical_in_reach`, `app.practitioner_in_reach`, migration 0171), inside the request's one scoped transaction, so scoping adds no round trip.

What `own` means, per record:

- **Patients** (`patients.read`, with their identifiers, recalls and clinical flags; and patient-level records under `clinical.read`/`clinical.write`: allergies, conditions, dental chart, files, treatment plans): patients the member has seen in a visit (`encounters.clinician_id`), who are booked with the member's practitioner record (any appointment not deleted), or whom the member registered (`patients.created_by`).
- **Appointments, queue tokens and leave** (`appointments.read`/`write`): those with the member's own practitioner record. Booking, walk-ins and leave with another doctor are refused; a walk-in must name the member as the doctor.
- **Visits, notes, prescriptions, procedures, vitals** (`clinical.*`, `prescriptions.issue`): the member is responsible (the visit's clinician, the note's author, who issued it), created it, or treats the visit it belongs to.
- **Invoices and payments**: billing permissions only come at `all` (the catalogue), so they are not narrowed. If that changes, `own` would mean bills for the member's visits.

**`assigned` behaves like `own`.** The schema has no care-team or patient assignment, so `assigned` narrows to the member's own records too. When care teams exist, `assigned` adds their patients.

**Consequences.** Starting a visit or prescribing needs the patient in reach first, so a narrowed doctor can't make any patient their own; booking a patient with themselves (at `appointments.write` `own`) does, and that is how a patient becomes theirs. Clinic set-up stays visible to anyone who can see the calendar (rooms, doctors, hours, leave, letterhead, the drug list). A patient's header still shows their next appointment even if it is with a colleague. Editing a patient (`patients.write`, which is `all` only) still needs the patient within `patients.read` reach, because the answer shows the record. The consultant template, which was `assigned` from the start, is now narrowed as intended.

