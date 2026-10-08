# Patient access: self-booking, prescriptions to patients, patient accounts

Status: 7 Oct 2026. D1–D4 decided by the founder on 4 Oct (below); D5 open. P1 and prescription links by email are built; P2 (accounts, links, patient API) and the first patient app (P3) are built on `feat/patient-app` (see "Built" at the end).

## What exists

- Staff booking enforces availability: the database refuses two active appointments in one chair at once (exclusion constraint); the API refuses a doctor who is busy elsewhere, on leave or outside working hours. Bookings appear on the calendar.
- Visits: notes (draft, sign, addenda), vitals, dental chart, procedures, treatment plans.
- Prescriptions: drugs or free text, dose and instructions, allergy check with override reason, print with QR, cancel and reissue.
- Patient share link: `/shared/{token}` with a PIN, throttled, lockout, expiry. Being added: sent to the patient automatically by email when the prescription is issued (no PIN, drugs or diagnosis in the email; the PIN is printed and told at the clinic).

## 1. Patients book for themselves

**Where:** a booking page on each clinic's portal host, `https://<clinic host>/book`. The clinic still comes from the host name (product rule 1).

**Availability:** `GET /api/v1/public/availability?date=…&practitioner_id=…` returns free slots computed from working hours, minus leave, minus active appointments, in the clinic's time zone, with the slot length and buffer from clinic settings. Public, throttled, returns no patient data.

**Booking:**
1. The patient picks a slot and verifies their email with a one-time code (Supabase, the same mechanism as staff sign-in, but a patient identity with no staff access).
2. `POST /api/v1/public/bookings` with the slot, name and phone. It runs the same booking rules as staff booking in one transaction; the exclusion constraint guarantees two patients can't take the same slot even at the same instant.
3. The appointment is created as `requested` or `confirmed` (**D1**) and appears on the calendar at once (requested ones styled differently, with Confirm and Decline for the front desk).
4. Matching: if the verified email or phone matches a patient in that clinic, the booking attaches to that record; otherwise a new record is created and marked self-registered. The response never reveals whether a record existed.
5. Confirmation and reminder go through the outbox (email now; SMS and WhatsApp later, **D2**).

**Abuse controls:** Cloudflare Turnstile on the page, throttles per IP and per verified identity, a cap on open bookings per identity, and cancellation by the patient up to a clinic-set cut-off.

## 2. Prescriptions reach the patient

- On issue: share link plus outbox message (in progress, email).
- Later channels through the same outbox: SMS (needs DLT template registration in India) and WhatsApp Business templates. Each has a per-message cost (**D2**).
- The link page works without any account, so patients without the app are covered.

## 3. Patient accounts and history (for the patient app)

**Identity:** a patient signs in with Supabase (email code now; phone code when SMS is enabled). A platform table `patient_accounts` holds their auth id and verified contacts. No clinic data lives there.

**Linking, never guessing:** a patient account sees a clinic's records only through an explicit link:
`patient_links (org_id, patient_id, account_id, linked_via, consented_at, revoked_at)`.
A link is created when the patient proves the contact the clinic has on file (one-time code to that email or phone) during booking or after a visit, or when the front desk links them in person. Unverified matches never link. The patient can revoke a link; the clinic can too.

**Consent and law:** consent is recorded per link with its purpose, as the Digital Personal Data Protection Act, 2023 expects. The clinic remains the data fiduciary for its records. Every patient read is written to the access log, like staff reads.

**What the patient sees (D3):** appointments (book, cancel), issued prescriptions (with the printable copy), invoices and receipts, and documents the clinic shares. Clinical notes stay internal by default; a doctor-approved visit summary can be shared.

**How data is read safely:** the patient API (`/api/v1/patient/…` on the app host) loads the account's active links, then reads each linked clinic inside a normal scoped transaction for that clinic, through patient-facing queries that filter on the linked `patient_id`. Row-level security keeps working unchanged; a test proves a patient never sees another patient or an unlinked clinic.

**One app or many (D4):** one Aarogyam patient app across clinics (history from every linked clinic in one place), with each clinic's branding on its own records.

**Later:** optional ABHA (Ayushman Bharat Digital Mission) linking, so records can move with the patient nationally (**D5**).

## Milestones

| | Scope | Depends on |
|---|---|---|
| P1 | Availability endpoint, public booking page, requested/confirmed on the calendar, confirmation email | D1 (**built** on `feat/self-booking`: Turnstile and patient cancellation are still to do) |
| P2 | Patient accounts, verified links, consent, patient API (appointments, prescriptions, invoices), access log | D3 |
| P3 | Patient app (KMP, Android first) on the P2 API | P2, D4 |
| P4 | SMS and WhatsApp channels for reminders and prescription links | D2, provider accounts |

## Decisions

Decided 4 Oct 2026: **D1** front desk confirms by default (clinic setting can auto-confirm); **D2** email now, WhatsApp next; **D3** prescriptions, invoices and appointments, plus doctor-approved visit summaries; **D4** one Aarogyam patient app. **D5** open.

Original questions:

- **D1** Self-bookings auto-confirm, or wait for the front desk? (Recommendation: a clinic setting, default "front desk confirms".)
- **D2** Email only for now (free), or add SMS/WhatsApp (paid per message, DLT registration)? (Recommendation: email now, WhatsApp next.)
- **D3** Patients see prescriptions, invoices and appointments; clinical notes only as a doctor-approved summary? (Recommendation: yes.)
- **D4** One Aarogyam patient app across clinics? (Recommendation: yes.)
- **D5** ABHA linking: later, after P3? (Recommendation: yes.)

## Built (P2 and P3 v1, 7 Oct 2026)

- **Accounts:** `patient_accounts` (platform table, definer functions only), made on the first `/api/v1/me/patient` request from the token's verified email. Email code only: phone codes wait for a paid SMS provider and DLT (backlog).
- **Links (migrations 0260–0261):** `patient_links` (`pending`, `active`, `declined`, `revoked`; consent time and purpose `care`) made only by a clinic-issued code (`patient_link_codes`, SHA-256 only, single use, 7 days, a new one replaces the old) or by a match the patient asks for (`POST /me/patient/link-requests` with the clinic's slug: exactly one active record with the verified email becomes `pending`; the answer is always `202`) that the clinic confirms on Patient 360. Never by phone or name.
- **Row-level security:** every clinic table has a restrictive `patient_account` policy. A transaction with actor kind `patient_account` (user = the account) sees only the linked record, its appointments, payments, issued prescriptions and bills (with lines), files marked shared, its own link, and the clinic's reference data; every other table denies. New clinic tables deny by default (`app.protect_clinic_table`), and the schema lint fails a clinic table without the policy.
- **Patient API:** on the app host `GET /me/patient`, `/home`, `/appointments`, `/prescriptions` (issued only, with the verify link), `/bills`, `/files`, `POST /links` (code), `/links/{id}/revoke`, `/link-requests`; on the clinic's host (it must have linked the account) `POST /me/patient/bookings` (the online booking rules, source `app`), `POST /me/patient/appointments/{id}/cancel` (open, and at least the clinic's booking notice ahead), `GET /me/patient/files/{id}/content`. Each read writes `access_log` (actor `patient`, purpose `patient_self`) in the same statement. Budget: 1 trip for the account and links, then 3 per linked clinic.
- **Clinic side:** Patient 360 "Invite to patient app" (`POST /patients/{id}/app-invitations`: creates the sign-in account, issues the code, emails it through the outbox; shown once with a QR code), app access with Confirm/Decline/Revoke (`GET /patients/{id}/app-access`, `POST /patient-links/{id}/confirm|decline|revoke`), and "Share with patient" per file (`PUT /attachments/{id}/sharing`).
- **App:** `mobile/patientShared`, `mobile/patientApp` (Compose), `mobile/patientIos` (SwiftUI): sign-in, my clinics (add by code), home, appointments with book and cancel, prescriptions, bills.
