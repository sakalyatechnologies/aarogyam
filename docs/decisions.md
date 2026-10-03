# Decisions

Newest first. Change a decision by adding an entry that supersedes it.

## 2026-10-03: Platform repositories are named by stack

**Decision.** `sakalya-platform` is renamed `sakalya-backend`, alongside the planned `sakalya-web`, `sakalya-android` and `sakalya-ios`. Crate names keep the `sakalya-` prefix.

## 2026-10-03: Clinics own their patient rows

**Decision.** Replace the shared `persons` table with clinic-owned `patients` rows. Cross-clinic views use `patient_links` (a patient's own account verified against each clinic's record) plus `consents`.

**Why.** With a shared person row, one clinic's edits to a name or phone number would show up at another clinic, and matching people automatically across clinics risks merging strangers. Under the DPDP Act each clinic is the data fiduciary for its own records, so each keeps its own copy, and the patient decides what is joined.

## 2026-10-02: Repositories

**Decision.** Three kinds of repository:

1. `sakalya-backend`: shared, product-agnostic Rust crates, depended on by git tag.
2. `arogyam`: one monorepo for the whole product (API, worker, migrations, specialties, phone apps, web, infra).
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

## Next milestone: foundation

1. Cargo workspace with the six product crates, depending on `sakalya-backend`.
2. Migrations for the ★ tables in `data-model.md`, with RLS and policy tests.
3. Host-based tenancy, session check, typed permission extractors, route-permission audit test.
4. Patients module end to end as the reference for all other modules.
5. Deploy to staging on Cloud Run with Supabase free.
