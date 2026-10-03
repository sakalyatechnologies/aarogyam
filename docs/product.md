# Arogyam: product brief

*Ārogyaṁ dhana sampadā*: health is wealth.

**One line.** Arogyam is the clinic software every kind of doctor in India can run their whole practice on, which grows into one place where patients keep their health records from every clinic.

Read this first for context. Technical detail lives in `architecture.md`, `database.md`, `decisions.md` and `cicd.md`.

## Vision

A doctor opens Arogyam and it feels built for their specialty, their clinic and their way of working. Everything around the consultation (booking, records, bills, stock, staff, reminders, a website) runs itself. Later, a patient opens Arogyam and sees their dental, general, gynecology and cardiology history together, shared only with the doctors they choose.

## The problem

- Clinic software in India is generic. A dentist, a gynecologist and a GP get the same screens, so doctors bend their work to the tool or fall back to paper.
- Front-desk work (appointments, walk-ins, bills, reminders) eats staff time and is error-prone.
- Doctors type notes they would rather speak, often switching between English and their own language.
- Most clinics have no website, or an outdated one, and no time to fix it.
- Patients carry paper files between doctors; nobody sees the whole picture.

## Goals

| Horizon | Goal | Proposed measure |
|---|---|---|
| Phase 1 | Pilot clinics run their whole day on Arogyam | 3–5 clinics stop using their old software for a month |
| Phase 2 | Clinics pay and onboard without help | Paying clinics; self-serve onboarding under 15 minutes |
| Phase 3 | Patients hold records from more than one clinic | Patients with records linked from two or more clinics |
| Phase 4 | Money side of health: claims and financing | A claim or financed treatment completed inside Arogyam |

## Who it is for

| User | What they need | Where they use it |
|---|---|---|
| **Clinic owner** (a doctor) | Run the practice: patients, money, staff, growth. See everything. | Web portal, phone |
| **Doctor** (associate) | Their schedule, patient history, quick notes and prescriptions | Phone, web |
| **Visiting consultant** | Only their assigned cases and their fees | Phone |
| **Front desk** | Appointments, walk-ins, registration, collecting payment, messages | Web on the reception PC |
| **Assistant or nurse** | Vitals, intake, photos, materials used | Phone or tablet |
| **Finance** | Bills, payments, expenses, salaries, reports, Excel exports | Web |
| **Patient and family** (phase 3) | Records from every clinic, bookings, bills, consent | Patient app and web |
| **Sakalya team** | Onboard clinics, plans, rollouts, support, analytics | Super admin console |

The owner decides what each staff role can see, down to hiding fees or phone numbers.

## What makes it different

1. **Built around the specialty.** Each specialty is a module with its own onboarding questions, forms, views and dashboard: a tooth chart for dentists, a pregnancy timeline for gynecologists, vitals trends for GPs.
2. **Talk instead of type.** Voice notes in Indian languages and Hinglish, transcribed and later drafted into a structured note the doctor signs.
3. **Automated by default.** Reminders, birthdays, recalls, stock deduction, lab tracking, daily closing and the clinic website happen without anyone remembering to do them.
4. **A website in minutes.** Answer a few questions and get a distinct, fast website on the clinic's own domain, with booking built in.
5. **Private by design.** Each clinic's data is isolated in the database itself, every chart view is logged, and Sakalya staff can't see patient records unless the clinic grants access.
6. **India first.** Phone sign-in, WhatsApp, UPI, GST-ready bills, Indian languages, works on patchy internet, data stored in India.

## Features

### Baseline: everything doctors already expect

- **Dashboard:** patient totals and demographics, registrations, appointments, visits and treatments by period and type.
- **Patients:** search by ID, name or mobile; custom and smart-card IDs; referral source; medical history; families; import from old software.
- **Appointments:** day, week, month and list views; doctor and chair lanes; walk-in tokens; confirmations; no-show tracking.
- **Clinical:** visits, notes, vitals, diagnoses, prescriptions with the doctor's registration number, treatment plans with estimates, photos and X-rays, signed consent forms.
- **Clinic operations:** lab work and lab payments, materials and stock with automatic deduction, equipment maintenance, staff salaries and advances, consultant fees.
- **Money:** price list, bills with a financial-year series, payments by cash, UPI or card, refunds, expenses, daily closing, finance reports with Excel export.
- **Messages:** SMS and WhatsApp with templates, history and audience filters, all consent-aware.
- **Account:** clinic and branch switching, roles, notifications, devices and sign-out everywhere, a PIN switch for shared reception PCs.

### Beyond the baseline

- **Specialty modules:** dental and general medicine first, then gynecology and obstetrics, pediatrics, and more.
- **Voice notes** with transcription, then AI-drafted notes the doctor approves.
- **Notification service:** appointment reminders, birthday wishes, recalls (six-month cleaning, BP review, vaccines), health tips and promo codes, with consent, quiet hours and cost tracking.
- **Automated clinic websites:** questionnaire, generated design, repository, build and deploy, with version history.
- **Personal onboarding:** specialty, hours (including split shifts), services and prices, branding, website and patient import in one guided flow.
- **Super admin console:** clinics, users, usage, revenue, website traffic and messaging costs; plans and feature rollouts; time-limited support access.
- **Plans:** features released by flag, included by plan, and allowed by role.

### Later

- **Patient app:** records from every clinic, family profiles, booking, bills, consent and "who viewed my record".
- **ABDM integration:** ABHA IDs and sharing records with other providers through the national health stack.
- **Referrals** between Arogyam doctors, with records attached by consent.
- **Lab and pharmacy integrations.**
- **Teleconsultation.**
- **Insurance claims** through NHCX.
- **Treatment financing.**
- **A chatbot assistant.**

## Specialties

| Specialty | Signature view | Phase |
|---|---|---|
| Dental | Tooth chart (32 adult, 20 child teeth), treatment plans, lab work per tooth | 1 |
| General medicine | Vitals trends, chronic-care panels, quick prescriptions | 1 |
| Gynecology and obstetrics | Pregnancy timeline, due date, scan windows | 2 |
| Pediatrics | Growth percentiles, vaccination schedule | 2 |
| Cardiology, neurology, ophthalmology, orthopedics, dermatology, Ayurveda | Specialty views built as doctors use them | 3 |

## Phases

| Phase | Scope | Done when |
|---|---|---|
| 0. Foundation | Platform crates, schema with isolation, sign-in, roles, plans and flags, CI/CD, staging | A clinic created in the console signs in at its own subdomain; clinics provably can't see each other's data |
| 1. Clinic MVP | The whole baseline for dental and general medicine, voice notes, onboarding, website linking, Android app (iOS a sprint behind) | 3–5 pilot clinics run their day on Arogyam for a month |
| 2. Growth | Website builder, billing for plans, console analytics, gynecology and pediatrics, AI notes, campaigns, multi-branch, ABDM M1 and M2 | Clinics pay and onboard on their own |
| 3. Patients | Patient app, cross-clinic records by consent, families, booking, referrals, labs, ABDM M3 | Patients hold records from two or more clinics |
| 4. Wealth | Insurance claims, treatment financing, teleconsultation, more specialties, assistant | A claim or financed treatment completes inside Arogyam |

## Business model

- **Subscription per clinic:** Solo, Clinic, Pro and Enterprise plans (prices to be set with pilots).
- **Add-ons:** message credits, AI minutes, extra branches, storage.
- **Pass-through costs:** SMS and WhatsApp are passed through at cost.
- **Website builder:** included in Pro.

## Product principles

1. Every screen should feel made for this doctor's specialty and role.
2. If a person has to remember to do it, automate it.
3. Speed at the front desk beats features nobody finds.
4. Patient data is private by default; sharing is always the patient's or clinic's explicit choice.
5. Work on a slow connection and a cheap phone.
6. Spend nothing until real patients, then spend only where it protects them.

## Not doing (for now)

- **In-patient hospital workflows:** wards, beds, operating theatres.
- **AI that diagnoses on its own:** AI only helps with documentation, and the doctor signs every note.
- **Holding clinics' money:** patients pay clinics directly.
- **Markets outside India**, until the India product is proven.

## Compliance

- **India's data protection law (DPDP Act):** core duties apply from May 2027. Clinics are the data fiduciaries for their records.
- **ABDM:** milestones M1 to M3.
- **Messaging rules:** DLT-registered SMS templates and approved WhatsApp templates.
- **Advertising:** medical and dental council rules on doctor advertising apply to clinic websites.
- **Data location:** all patient data stays in India.

## Open questions

- **Pilots:** which clinics, and which software they use today, so the import works from it?
- **Pricing** per plan.
- **Domains:** final domain names and the trademark search for "Arogyam".
