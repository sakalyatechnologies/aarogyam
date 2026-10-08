# Decisions

Newest first. Change a decision by adding an entry that supersedes it.

## 2026-10-07: Patient accounts, links and the patient API

**Decision.** Patients sign in with Supabase email codes into a platform `patient_accounts` row (no clinic data). They read a clinic's records only through an active `patient_links` row made by a clinic-issued link code or by a match the clinic confirms; never by phone or name. Patient reads run in a normal clinic transaction with actor kind `patient_account`, and restrictive `patient_account` policies on every clinic table limit them to the linked record (deny by default for new tables, checked by the schema lint). Cross-clinic reads live on the app host and aggregate per linked clinic; writes for one clinic (book, cancel) and file downloads go to that clinic's host, so the clinic still comes from the host. Patients see appointments, issued prescriptions, issued bills and files the clinic marked shared; notes and the chart stay internal (D3). Booking from the app reuses the public booking rules in the public scope, for the linked record.

**Why.** RLS keeps enforcing isolation without a second database role, and a patient bug can only under-show, never leak another record. Codes and confirmed matches satisfy "verification before linking" without paid SMS.

## 2026-10-06: Bringing in a clinic's existing records

**Files (built).** A clinic uploads its own CSV or Excel file in whatever layout it has (`POST /api/v1/imports/sessions`, web Patients → Import).

- **Parsing in the API, never stored as a file.** CSV in any delimiter (comma, semicolon, tab, pipe) and encoding (UTF-8 with or without a byte-order mark, UTF-16, else Windows-1252, which Excel on Windows writes); `.xlsx` by content (calamine), first sheet or one chosen by name; old `.xls` is refused with "save as .xlsx or CSV". Limits: 5 MB streamed and refused at the first byte over, 64 MB unpacked (zip bombs), 5,000 rows, 100 columns. The parsed rows live only in an `import_sessions` row: cleared on commit, on discard, and 24 hours after upload (ended when the clinic next uploads), and excluded from the audit log. The original file is not kept; keeping it would need a clinic-level attachment the clinic can delete, which doesn't exist yet (`attachments` belong to a patient).
- **Mapping without AI.** The header row is found below any title rows. Each column gets a suggested field from its header (English, Hindi and Marathi synonyms in Latin letters and Devanagari: "Naav", "Mobile No.", "Vay", "Ling", "Patta", "Baki"; headers about someone else, such as "Father's name", never match), from its values (Indian phones, day-first dates and month names, ages such as "32 yrs", sex words, emails; serial-number columns are ignored), and from what the clinic chose last time for the same header (`import_column_memory`, saved on commit). Each has a confidence; a header contradicted by its values is doubted. Each field goes to one column. The clinic reviews and changes the mapping before anything is checked.
- **Missing data: import what is present, never invent.** Only a row without a usable name fails. Unreadable values are left empty with a warning that never repeats the value; two-digit years are refused rather than guessed. A new patient lacking a phone, sex or date of birth (or age) is imported and put on the front desk's to-do list (`patient_gaps`, `GET /api/v1/imports/incomplete`); what is still missing is worked out from the current record, so filling a detail clears it, and "Can't get these" dismisses an entry. Balances are recognised (so they aren't mistaken for another field) but not imported: opening balances belong in billing.
- **Duplicates by phone and name** (lower case, single spaces), against the clinic's patients and earlier rows. Rows without a phone are never called duplicates. The clinic chooses skip (default) or merge, per file and per row, or "import as new". A merge only fills empty details (sex when unknown, date of birth, email, address, last visit, identifiers); it never overwrites.
- **Review before commit.** Preview shows each row's result, missing details, warnings and the values as they will be saved (contact details hidden without `patients.contact`), and saves nothing. Commit is one transaction per uploaded file (the batch, at most 5,000 rows), locks the session so concurrent commits serialise, and is idempotent: a second commit returns the recorded result. Each row is recorded in `import_rows` against its import, which carries the file name, sheet and session: the source reference of every imported record.
- **Round trips:** upload 3, preview 4, a first commit at most 9 (one statement per table written), a repeated commit 4, the to-do list 3.

**Paper (designed, not built).** Photographed or scanned case sheets become patients through extraction, with the same review and to-do list.

- **Upload:** the phone or web uploads images or PDF pages as a batch; each page is stored as a clinic-level import attachment in Supabase Storage (Mumbai) that the clinic can delete, and becomes an `import_sessions` row with `file_kind = 'scan'`.
- **Extraction is a background job, never in the request path:** the upload writes an outbox row; the worker sends the page to the provider, stores the extracted fields per row with a confidence per field and the page region they came from, and marks the session ready. Failures retry with the outbox's backoff and end as "needs manual entry", never as guessed values.
- **Provider requirements, all contractual and checked before use:** no training or retention on our data (zero data retention, or deletion within the request); processing in India where the law or a clinic requires it, else a region listed in the clinic's data-processing agreement; a data-processing agreement naming Sakalya as the fiduciary's processor (DPDP Act); encryption in transit; no human review of content; audit of each call by session id (never content). Candidates are evaluated against these, not by brand; an on-device or self-hosted OCR model (on Cloud Run in Mumbai) is the fallback if no provider qualifies. The extraction prompt asks only for fields on the page and for "unreadable" instead of a guess.
- **Side-by-side review:** each page is shown next to its extracted fields, every field highlighted on the page and marked by confidence; low-confidence fields start empty. Nothing becomes a record until a person confirms the page. Confirmed rows go through the same commit as files (lenient rows, duplicates, to-do list), with the scan id, page and region as the source reference; extracted clinical history arrives as `source = 'ai_draft'` and needs a clinician's confirmation.
- **Cost:** within the free tier or the clinic's plan; a per-page counter shows usage before a batch is sent.

## 2026-10-05: Central sign-in and the session handoff

- **People sign in once, on the public site** (`aarogyam.sakalyatechnologies.com/sign-in`). `/me` then decides: Sakalya staff to the console, one clinic to that clinic, several to a picker. Portals send signed-out visitors there with `?next=<host>` (console: `?next=console`) when `VITE_CENTRAL_SIGNIN_URL` is set, which `scripts/deploy-workers.sh` does for every deployed build; local development (unset) keeps the in-app sign-in. The site honours `next` only for a host `/me` lists. Signing out on a clinic host returns to the site.
- **A session belongs to one origin, so it is handed over, not shared.** `POST /api/v1/auth/handoff {host}` (signed in) returns a random 32-byte code valid 60 seconds, bound to the person and that host, only for an active member of that open clinic or staff for the console (otherwise `404`). The browser goes to `https://<host>/auth/handoff#code=…`; the fragment never reaches a server or log. `POST /api/v1/auth/handoff/redeem {code}` on that host uses the code up on the first attempt, right or wrong, and answers with a Supabase magic-link token hash (`generate_link`, nothing emailed) that the page trades with `verifyOtp` for a session of its own; locally, a development token. Only the code's SHA-256 is stored (`auth_handoffs`, migration 0161); both steps are in the change history and logged as `handoff.*` events; redeem is throttled to 20 per IP per 10 minutes.
- **`/me` says `console_access`** for active Sakalya staff. Staff only: the console; staff with clinic memberships: the picker with "Sakalya console" first. **Super admin accounts should be separate from clinic accounts;** support access to a clinic goes through time-limited grants (planned). Enforced in the database (migration 0172): active platform staff can't hold an active clinic membership or accept an invitation, and the last active owner can't be removed.
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

## 2026-10-07: Clinic sites go live

**Problem.** Publishing in Settings, Website saved a flag and showed a placeholder address; nothing served the site.

**Decision.** Reuse the automatic address design (2026-10-05) with a second host kind.

- **A `site` host next to the `portal` host.** Publishing writes `org_domains` (kind `site`, migration 0240) through definer functions that take the clinic from the transaction, never an argument; the outbox job claims it like a portal host and uploads a `<slug>-site` Worker bound to the shared `aarogyam-site` Worker. Status is `pending`, `ready` or `failed`, shown in Settings. Free address `<slug>-site.spring-snow-130f.workers.dev` now, `<slug>-site.sakalyatechnologies.com` with `wildcard` later: only configuration changes.
- **Take down removes it.** The API 404s at once (the host stops verifying); status `removing` lets the job delete the Worker and the row, so the 100-Worker limit isn't spent on dark sites. Publishing again recreates it.
- **Public by construction.** `aarogyam-site` forwards only `GET /api/v1/public/site` and its pictures; every other `/api` path is a 404 at the edge. The API returns the same 404 for an unpublished site, a clinic with no site host, and another clinic's host. Booking stays the portal's `/book` page, framed.
- **No placeholders.** Defaults are local (`localtest.me`); `scripts/cloud-run-deploy.sh` and `scripts/demo-api.sh` set the real templates.

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

**Second step for super admins (built 2026-10-07).** Sakalya staff need an authenticator-app code (Supabase Auth TOTP MFA, free) before the console. The console, after sign-in by either method or the central handoff, checks `auth.mfa` and shows an enrolment screen (QR code and key) or a code prompt until the session is `aal2`. The API's `PlatformRequest` refuses every console route with `403 mfa_required` unless the token's `aal` claim (parsed by `sakalya-auth`) is `aal2`; non-staff still get the plain staff-only `403`, so the check reveals nothing. Clinic users are unaffected (optional MFA for them is in the backlog). Development sign-in tokens carry `aal2` (there is no second step locally). **Setup:** TOTP must be enabled in the Supabase project (Authentication, Multi-Factor; on by default). **Recovery:** a staff member who loses their authenticator is reset by deleting their factor in the Supabase dashboard (Authentication, Users); they then enrol again at next sign-in. Enrolling is open to a signed-in staff session, so the first sign-in of a new super admin should be done promptly after the grant.

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


## 2026-10-07: Notice and consent records (DPDP)

**Decision.** `aarogyam.patient_consents` (migration 0280) records, per patient and purpose (`care`, `reminders`, `promotional`, `sharing`, `research`): the clinic's notice version the patient was shown (a free label such as `v1 2026-10`), when they agreed, how (`paper`, `verbal`, `app`) and which staff member recorded it. A withdrawal fills `withdrawn_*` once and the row is then final (`freeze_when_final`); consenting again adds a new row. At most one active consent per patient and purpose. The routes are `GET`/`POST /patients/{id}/consents` and `POST /consents/{id}/withdraw`, under `patients.read` and `patients.write` (so reception can record them, and scopes apply). Every change is in the change history. Patient 360 shows them in a Consent tab, and the header and quick look say whether consent to care is recorded; this replaces the earlier "consent form on file" label, which only looked at a Files item.

**Why.** The clinic is the data fiduciary and must be able to show a notice was given and consent taken, and when it was withdrawn (DPDP sections 5 to 6). The notice text itself is the clinic's document (see `web/apps/website` legal pages for a template); we record the version, not the text, until clinics need to author notices in the product.

**Not done.** Withdrawal does not yet switch off messages (the outbox still uses `consent_channels`): wire promotional and reminder withdrawals to it when messaging ships. Patient self-service consent (app) comes with the patient app.

## 2026-10-07: Retention schedule and anonymisation design (DPDP)

**Decision.** Each class of record has a default retention period, kept in code (`aarogyam-domain/src/retention.rs`) and here, and an operator job lists what is past it: `aarogyam retention` (needs `ARO_DB__OWNER_URL`; add `--sample N` for identifiers). It is a dry run and has no other mode: `--apply` exists only to refuse, until erasure is built. Counts, the oldest date and a few IDs are logged per clinic and class (`retention.past` events), never names. A test checks the code table against this one.

| Class | What | Kept | Counted from | Basis (a lawyer must confirm) |
|---|---|---|---|---|
| `patient_record` | Patient and everything under them: visits, notes, prescriptions, files, charts | 7 years; children until 21 | Last visit, appointment or bill | Medical councils require records for at least 3 years; the Limitation Act (3 years from majority) and disputes argue for longer; 7 is the cautious default; DPDP section 8(7) says erase when the purpose ends |
| `invoices` | Bills and payments | 8 years | Date issued | GST law (72 months) and company law (8 years) |
| `outbox` | Sent or abandoned messages | 90 days | When sent or abandoned | Not needed once delivered; names recipients |
| `share_links` | Patient links, after expiry | 30 days | Expiry | Not needed once expired |
| `import_sessions` | Uploaded spreadsheets of patients | 30 days | Upload | Working copy only; the patients are in the clinic's records |
| `access_log` | Who viewed a record | 3 years | Entry | Lets a clinic answer "who saw my record"; the DPDP Rules ask for logs to be kept at least 1 year |
| `audit_events` | Who changed a record | 7 years | Entry | As the patient record it describes |
| `clinic_applications` | Requests for access that were never approved | 365 days | Decision | Not needed after the decision |

A clinic may keep records longer where its profession or a dispute requires; per-clinic overrides, and a legal hold that stops erasure of a patient, come before erasure is built (backlog). Consent records stay with the patient record and for 3 years after it.

**Anonymisation and erasure design (not built).**

1. **Erase is the default end of a patient record; anonymise only what the clinic still needs for statistics.** A patient row stays as a tombstone (`id`, `org_id`, `number`, `status = 'erased'`, `erased_at`) because other tables point at it; identity columns (name, search name, phones, email, address, birth date) are cleared. Bills inside their 8 years keep their lines and totals, with the recipient snapshot cleared, until they too pass retention.
2. **One transaction per patient, in dependency order:** files (the rows, then the Storage objects, with an outbox row to retry a failed delete), voice notes, notes and addenda, observations, conditions, allergies, specialty records, procedures, treatment plans, prescriptions and their items, share links, recalls, queued messages, then the identity columns. Consent rows stay and point at the tombstone.
3. **The change history holds old values.** `audit_events.changes` for the erased rows is scrubbed by an owner-run function (the table is append-only to the app role); access-log entries hold only IDs and stay.
4. **Backups.** Erased data remains in backups until they expire (14 daily and 8 weekly dumps, `docs/ops.md`: about 8 weeks). The notice says so. An `erasure_log` of erased patient IDs is replayed after any restore so erased people don't return.
5. **Who decides.** The dry-run report goes to the clinic owner, who confirms by clinic and class; the job then runs with `--apply --clinic <slug>`, and the run records `retention.applied` with counts in the change history. A patient's own erasure request (DPDP section 12) uses the same procedure, but refuses records still inside their legal minimum and says why.
6. **Needs first:** the legal-hold flag, the per-clinic override, an `erased` patient status the UI understands, and a restore-drill step for the erasure log.
