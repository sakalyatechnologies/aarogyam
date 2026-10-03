# Decisions

Newest first. Change a decision by adding an entry that supersedes it.

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

## Next milestone: foundation (golden clinic journey)

1. Cargo workspace with the six product crates, depending on `sakalya-backend`.
2. Migrations for the ★ tables in `data-model.md`, with RLS and policy tests.
3. Host-based tenancy, session check, typed permission extractors, route-permission audit test.
4. Patients module end to end as the reference for all other modules.
5. Deploy to staging on Cloud Run with Supabase free.
