# Aarogyam: product brief

*Ārogyaṁ dhana sampadā*: health is wealth.

**North star.** A doctor opens Aarogyam and it feels built for their specialty, their clinic and their way of working.

**One line.** Aarogyam is the operating system for every kind of clinic in India, which grows into one place where patients keep their health records from every doctor they visit.

Read this first for context. Technical detail lives in `architecture.md`, `database.md`, `decisions.md` and `cicd.md`.

## Vision

A doctor opens Aarogyam and sees today's work, laid out for their specialty. Everything around the consultation (booking, records, prescriptions, bills, stock, staff, reminders, a website) runs itself. Later, a patient opens Aarogyam and sees their dental, general, gynecology and cardiology history together, shared only with the doctors they choose.

## The problem

- Clinic software in India is generic. A dentist, a gynecologist and a GP get the same screens, so doctors bend their work to the tool or fall back to paper.
- Front-desk work (appointments, walk-ins, bills, reminders) eats staff time and is error-prone.
- Doctors type notes they would rather speak, often switching between English and their own language.
- Most clinics have no website, or an outdated one, and no time to fix it.
- Patients carry paper files between doctors; nobody sees the whole picture.

## Product structure

Customers see one brand. Internally Aarogyam has three parts:

| Part | Holds | Who uses it |
|---|---|---|
| **Clinic OS** | Appointments, Patient 360, clinical records, prescriptions, billing, staff, inventory, communication, website | Doctors and clinic staff |
| **Patient** (phase 3) | My health, my doctors, records from every clinic, family, consent, insurance | Patients and families |
| **Platform** | Identity, permissions, consent, notifications, payments, audit, integrations (ABDM, WhatsApp, labs) | Every part |

### Specialty Packs

Clinic OS has a shared **Core** (patients, appointments, visits, notes, prescriptions, billing, staff, documents, consent). Each specialty is a **Specialty Pack** on top of Core: its onboarding questions, forms, data schemas, views, dashboard widgets, vocabulary and permissions. Packs are mostly configuration, so a new specialty is controlled expansion rather than a redesign.

| Pack | Signature views | Phase |
|---|---|---|
| Dental | Tooth chart (32 adult, 20 child teeth) with history per tooth, treatment plans, lab work per tooth, dental imaging | 1A |
| General medicine | Vitals trends, chronic-care panels, quick prescriptions | 1B |
| Gynecology and obstetrics | Menstrual history, pregnancy timeline, due date, antenatal visits, scan windows | 2 |
| Pediatrics | Growth percentiles, vaccination schedule, development milestones | 2 |
| Cardiology, neurology, ophthalmology, orthopedics, dermatology, Ayurveda | Built as doctors use them | 3+ |

## Signature experiences

### First ten minutes: onboarding
Onboarding is a signature experience. Target: a clinic is ready, self-served, in under 15 minutes.

1. **What kind of practice do you run?** Dentist, general physician, gynecologist, pediatrician and more. This picks the Specialty Pack.
2. **How do you practice?** Solo, with assistants, multi-doctor, or multiple branches.
3. **What do you use today?** Paper, Excel, or other software. This decides the import path.
4. **Do you have a website?** If yes, connect it and add booking. If no, Aarogyam offers one.
5. **Staff, services and fees, hours** (including split shifts), and **branding** from the logo.
6. **Bring your patients** in, and switch on reminders.
7. **Your clinic is ready.**

### Today
A doctor at 9 AM sees today's work, not analytics: today's numbers, who is **Now** (waiting time, the reason, a Start consultation button), and who is **Up next**. Reception sees the queue and arrivals. Owners see the day's money and attention items underneath. Today's work beats dashboards.

### Patient 360
One screen per patient:
- **Header:** identity and allergies.
- **Timeline:** every visit, treatment, prescription and document.
- **Tabs:** vitals, images, bills and payments, consent, communication, family.
- **Specialty Pack views:** for example the tooth chart.

### Voice to note
The doctor taps the microphone and speaks in English, Hindi, Marathi or Hinglish. Aarogyam transcribes the recording and, from phase 2, drafts a structured note (complaint, history, examination, assessment, treatment) for the doctor to review, edit and sign. AI never diagnoses on its own and nothing enters the record unsigned.

### Before and after the consultation
- **Past-visit summary** (phase 2): a short AI summary of the patient's previous visits before the doctor starts. It only summarises what's recorded.
- **Smart Scan** (phase 2): photograph a paper lab report or old file. Aarogyam extracts values (HbA1c, haemoglobin, BP) into the record once the doctor confirms. It also helps clinics move off paper during onboarding.

### Prescriptions
- **Writing:** doctors write prescriptions from favourites and the medicine list, in the patient's language. **Quick Rx:** repeat the last prescription, or start from favourites saved per diagnosis.
- **Safety checks:** the doctor always decides; Aarogyam warns.
  - **Phase 1A:** a warning when a medicine matches a recorded allergy.
  - **Phase 2:** drug interactions, contraindications, pregnancy and breastfeeding cautions, child dosing and precautions, from a licensed Indian drug database.
  - **Overrides:** each override is recorded with its reason.
- **Printing:**
  - **Layout:** on the clinic's letterhead or plain paper (A4, A5 or thermal).
  - **Contents:** the doctor's name, qualifications and registration number, with generic names in capitals.
  - **Aarogyam footer:** a small "Prescribed with Aarogyam" line plus a QR code that opens the verified digital copy. Higher plans may later remove the footer.
- **Changes:** an issued prescription never changes. A correction cancels it and issues a new one.
- **Staff access:** staff see every prescription in Patient 360 and can reprint.
- **Patient access:**
  - **Now:** patients get an expiring WhatsApp or SMS link that opens after a one-time code.
  - **Later:** the patient app shows prescriptions from every clinic.

## Who it is for

| User | What they need | Where they use it |
|---|---|---|
| **Clinic owner** (a doctor) | Run the practice: patients, money, staff, growth | Web portal, phone |
| **Doctor** (associate) | Today's patients, history, quick notes and prescriptions | Phone, web |
| **Visiting consultant** | Only assigned cases and their fees | Phone |
| **Front desk** | Appointments, walk-ins, registration, payments, messages | Web on the reception PC |
| **Assistant or nurse** | Vitals, intake, photos, materials used | Phone or tablet |
| **Finance** | Bills, payments, expenses, salaries, reports, Excel exports | Web |
| **Patient and family** (phase 3) | Records from every clinic, bookings, bills, consent | Patient app and web |
| **Sakalya team** | Onboard clinics, plans, rollouts, support, analytics | Super admin console |

Access is **role plus permissions plus scope**. A role is a starting bundle. The owner can switch individual permissions on or off, such as seeing fees, seeing phone numbers, exporting data, deleting documents or managing staff. Each permission is scoped to the clinic, a branch, or assigned patients only.

## Trust: identity, consent and the access ledger

- **Identity:**
  - A phone number is contact information, never identity, because families share numbers and numbers change.
  - Inside a clinic, a matching phone number triggers a duplicate warning, never an automatic merge.
  - Merges keep the full history and can be undone.
- **Linking across clinics** (phase 3): a patient's account links to their record at each clinic only after verification, by one-time code, ABHA or the clinic confirming.
- **Who owns what:** the clinic owns its clinical record and its legal duties; the patient controls whether records are shared across clinics.
- **Consent** is a first-class record: who may see what, for which purpose and data categories, granted when, expiring when, revoked when, and from which source. Every change is audited.
- **Access ledger:** every sensitive view records who, what, why, when and from which device. Patients can see who viewed their records. Privacy becomes a trust feature, not only a compliance duty.
- **Isolation:** each clinic's data is isolated in the database itself. Sakalya staff can't see patient records unless the clinic grants time-limited access.

## Works offline

Clinics in India lose connectivity, so the phone apps keep working without it.

| Offline | Works |
|---|---|
| **Read and write** | Today's appointments and queue, registering and finding patients (the clinic's recent and scheduled patients are kept on the device), visits, draft notes and signing, vitals, diagnoses, procedures, prescription drafts, photos and voice notes (uploaded when back online), the tooth chart |
| **Read only** | Doctors, hours, price list, medicines, templates, settings |
| **Online only** | Issuing bill and prescription numbers, collecting online payments, sending messages, permissions and plans |

Changes made offline sync when the connection returns. If two devices change the same record, notes and specialty records keep both versions for the doctor to choose; simple fields keep the latest change and the audit log keeps the other.

## Features

### Baseline: everything doctors already expect

- **Dashboard:** patient totals and demographics, registrations, appointments, visits and treatments by period and type.
- **Patients:** search by ID, name or mobile; custom and smart-card IDs; referral source; medical history; families; import from old software.
- **Appointments:** day, week, month and list views; doctor and chair lanes; walk-in tokens; confirmations; no-show tracking.
- **Clinical:** visits, notes, vitals, diagnoses, prescriptions, treatment plans with estimates, photos and X-rays, signed consent forms.
- **Clinic operations:** lab work and lab payments, materials and stock with automatic deduction, equipment maintenance, staff salaries and advances, consultant fees.
- **Money:** price list, bills with a financial-year series, payments by cash, UPI or card, refunds, expenses, daily closing, finance reports with Excel export.
- **Messages:** SMS and WhatsApp with templates, history and audience filters, all consent-aware.
- **Account:** clinic and branch switching, roles, notifications, devices and sign-out everywhere, a PIN switch for shared reception PCs.

### Beyond the baseline

- **Specialty Packs**, the signature experiences above, and **automation:** reminders, birthdays, recalls, stock, lab tracking, daily closing.
- **Clinic websites:**
  - **Phase 1:** connect an existing website and add booking.
  - **Phase 2:** about five excellent templates filled from the clinic's details (logo, colours, photos, services, doctors, hours, contact, domain). Each lives in its own repository, built and deployed automatically.
  - **Later:** AI-written copy.
- **Teleconsultation** (phase 2): a video link from the appointment, then an e-prescription, under the 2020 Telemedicine Practice Guidelines.
- **Patient page** (phase 2): before the full app, patients open a light page from their link to see prescriptions and bills and upload old reports.
- **Prescription analytics** (phase 2): prescribing patterns for the doctor's own review, such as top diagnoses and medicines and repeat rates. Shown only to the clinic; never sold or shared.
- **Super admin console:** clinics, users, usage, revenue, website traffic and messaging costs; plans and feature rollouts; time-limited support access; a quality page fed from a separate operations store.
- **Plans:** a feature appears only when it is released (flag), included in the plan (entitlement), and allowed for the person (permission).

### Later

- **Patient app:** records from every clinic, family profiles, booking, bills, consent and "who viewed my record".
- **ABDM integration:** ABHA IDs and sharing records through the national health stack.
- **Referrals** between Aarogyam doctors, with records attached by consent.
- **Lab and pharmacy integrations.**
- **Insurance claims** through NHCX.
- **Treatment financing.**
- **Devices and wearables.**
- **An assistant.**

AI is an accelerator, never the product: Aarogyam works fully without it.

## Goals and phases

| Phase | Scope | Done when |
|---|---|---|
| **0. Foundation** | Multi-tenancy, identity, permissions, audit, consent, offline architecture, CI/CD, staging | A clinic created in the console signs in at its own subdomain; clinics provably can't see each other's data |
| **1A. Dental** | Core Clinic OS plus the Dental pack: Today, Patient 360, appointments and queue, visits, tooth chart, treatment plans, prescriptions (Quick Rx, allergy check, print and patient link), bills and payments, staff, voice notes, onboarding, website linking, web portal, doctor mobile app | 3–5 dental clinics run their whole day on Aarogyam for 30+ days and stop using their old software. We measure time saved, appointments, collections, notes and retention. |
| **1B. Platform proof** | General Medicine pack on the same Core | A GP clinic runs on Aarogyam without Core changes, proving the pack architecture |
| **2. Growth** | Self-serve onboarding, website templates, plans and billing, AI-drafted notes and past-visit summaries, prescription safety checks, Smart Scan, teleconsultation, the patient page, prescription analytics, gynecology and pediatrics, campaigns, multi-branch, inventory depth, ABDM M1 and M2 | Clinics pay and onboard on their own |
| **3. Patient network** | Aarogyam Patient, cross-clinic records by consent, families, booking, referrals, labs, ABDM M3 | Patients hold records from two or more clinics |
| **4. Health Finance** | Insurance claims, treatment financing, devices, more specialties | A claim or financed treatment completes inside Aarogyam |

## Business model

- **Subscription per clinic:** Solo, Clinic, Pro and Enterprise plans.
- **Included per plan:** monthly WhatsApp and SMS credits, and a support tier (standard or priority).
- **Add-ons:** extra message credits, AI minutes, extra branches, storage.
- **Pass-through costs:** messages are passed through at cost.
- **Not fixed yet:** prices are not set. Pilots test willingness to pay separately for core software, reminders and WhatsApp, the website, AI documentation, extra doctors, branches and storage. One hypothesis to test: the website may work better as a free way to win clinics than as a Pro feature.

## Compared with existing clinic software

Established products (for example HealthPlix) lead with prescription-centred records, medication safety checks, teleconsultation and AI helpers around the prescription. Aarogyam matches those, and differs in five ways:
1. **Specialty depth:** visual Specialty Packs such as the tooth chart.
2. **Voice:** notes in Indian languages and Hinglish.
3. **The whole clinic:** stock, lab work, payroll, consultant fees and recalls run in one place.
4. **Branding:** per-clinic white-labeling and websites.
5. **Trust:** offline-first phones, an access ledger and patient-controlled consent.

## Product principles

1. Every screen should feel made for this doctor's specialty and role.
2. Today's work beats dashboards; speed at the front desk beats features nobody finds.
3. If a person has to remember to do it, automate it.
4. Patient data is private by default; sharing is always an explicit choice.
5. Work on a slow connection and a cheap phone.
6. AI accelerates; the product stands on its own.
7. Spend nothing until real patients, then spend only where it protects them.

## Not doing (for now)

- **In-patient hospital workflows:** wards, beds, operating theatres.
- **AI that diagnoses on its own,** or decision support that suggests diagnoses. Rule-based care reminders, such as "HbA1c due", are fine.
- **Selling data or research access:** no paid research projects built on clinic or patient data.
- **Holding clinics' money:** patients pay clinics directly.
- **Markets outside India**, until the India product is proven.

## Compliance

- **DPDP Act and Rules 2025:** commencement is staged. The Rules were notified on 13 November 2025; consent-manager provisions apply after one year, and the major operational duties (notice, consent, security safeguards, breach reporting, retention) apply from about May 2027. Clinics are the data fiduciaries for their records.
- **ABDM:** milestones M1 (ABHA and registries), M2 (sharing records) and M3 (fetching records), planned across phases 2 and 3.
- **Messaging rules:** SMS uses DLT-registered templates; WhatsApp templates are approved by Meta. Promotional messages need opt-in.
- **Advertising:** medical and dental council rules on doctor advertising apply to clinic websites.
- **Prescriptions:** medical council requirements apply.
- **Data location:** all patient data stays in India.

## Open questions

- **Pilots:**
  - Which 3–5 dental clinics after Smile Catchers?
  - Which software do they use today, so import works from it?
- **Patient relationship:** in phase 3, a patient can join Aarogyam and see records created by clinics. We need to define in product and legal terms what the clinic controls, what the patient controls, and what happens when a patient leaves a clinic.
- **Pricing:** per plan, and whether the website is paid or free.
- **Domains:** final names and the trademark search for "Aarogyam".
