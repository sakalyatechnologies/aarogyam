# Patient self check-in (QR) and quick registration

Status: draft v1 (24 Nov 2026). Owner: backend/web session. Phones follow through the same API.

## 1. What the founder asked
- A QR code the clinic prints. A walk-in scans it, registers themselves (or a family member), says what is
  wrong, and gives basic details. The doctor or desk no longer types this.
- The clinic website's booking form registers the patient with the same details.
- Quick: a few required fields, everything else skippable. Consent to care is required.
- PIN code fills city and state, here and everywhere an address is typed (clinic setup included).

## 2. Principles
1. **Two screens at most.** Screen 1 = required (about 30 s). Screen 2 = optional, with "Skip" as a big button.
2. **The desk confirms; the public never creates patients.** A scan creates an *arrival request*, not a patient.
   The desk accepts it in one tap (which registers or matches the patient and gives a queue token). This keeps spam,
   jokes and duplicates out of the patient list, and lets the desk match "Ravi" to the existing Ravi.
3. **Nothing leaks.** Public answers never say whether a phone or name already exists. No patient data in URLs,
   logs, toasts or notifications. Pending requests are deleted after 24 h if nobody acts on them.
4. **Reuse.** Accepting runs the existing walk-in path (`app::walk_ins`, intake allergies/conditions, desk
   consents) and the phone-match lookup (`PhoneMatches`). Online booking keeps its email-code sign-in.

## 3. Patient flow (QR)
URL: `https://<clinic portal host>/arrive` (a public page like `/book`; the clinic comes from the host, same
`ClinicHost` rule; console and app hosts 404). Optional `?b=<branch id>` when a clinic prints one QR per
branch. No other parameters.

**Screen 1 — "Welcome to <Clinic>" (required)**
- Who is this for? `Me` | `My child / family member`. Family shows "Your name" (the contact person) and the
  relation (`parent`, `spouse`, `child`, `sibling`, `other`) under the patient's name.
- Patient first name*, last name* (stored as `full_name = first + " " + last`; last name may be one letter).
- Mobile number* (+91 assumed; same parser as booking).
- "What brings you in?" — chips (Tooth pain, Cleaning, Check-up, Broken tooth, Braces, Follow-up, Other) plus an
  optional line of text. At least one chip or text is required. Chips come from the clinic's specialty
  (dental list now; others later), so this stays generic.
- [x] *I agree to <Clinic> keeping my health record to treat me* (required; links to the clinic's privacy notice,
  the same notice the booking page uses). Recorded as consent `care`, method `app`.
- Button: **Continue**.

**Screen 2 — "A few more details (optional)"**: one screen, every field optional, **Skip** and **Done** both submit.
- Email.
- Sex (`Female` / `Male` / `Other`), date of birth *or* age (one field: "Age or date of birth").
- PIN code → city, district, state fill in (editable); address line. See §6.
- Health: "Any of these?" chips: None, Diabetes, High BP, Heart condition, Pregnant, Blood thinners, plus
  "Allergies" with a text field. Patient-reported until a clinician confirms (the existing intake rule).
- [ ] *Send me appointment reminders on WhatsApp/SMS* (unticked; DPDP). Promotional consent is not asked here.

**Done screen**: "Thanks, <first name>. Please take a seat; the desk will call you." When the desk accepts,
the page (if still open) shows the queue token: "Your token: A-12". It polls a status endpoint with a random
receipt kept in page memory/sessionStorage (never in the URL). It stops polling after 2 h.

## 4. Desk flow (web portal now; phones next)
- **Queue page**: a strip "2 checked in by QR" above the queue (the existing poll refreshes it). It opens a sheet
  with one card per request: name, family relation, phone, reason chips, health flags, time ago.
  - When phone matches exist (same lookup as walk-in), the card says "Same phone as: Ravi Kumar (P-0123) · Use" and
    the desk picks the existing patient or "New patient".
  - **Add to queue** (default) = register or match, record intake and consents, check in, and issue the token.
    The doctor picker defaults to "Any".
  - **Register only** = the same without a token (they came to book, not to be seen).
  - **Dismiss** (spam or a duplicate). The row is deleted.
- Matching an existing patient **fills blanks only**. A differing value (email, address) shows as "New: …"
  on the card and is applied only if the desk ticks it. Nothing is overwritten silently.
- Permission: accepting needs what the walk-in needs (`patients.write` + `appointments.write`). Listing needs
  `patients.read`.

## 5. Clinic settings — "Patient QR"
Settings → Front desk → **Patient check-in QR**:
- On/off switch (`self_check_in` in clinic settings). It defaults to **on** for the demo and review clinics and
  **off** for new real clinics until they print.
- Shows the QR (client-side generator, lazy chunk, settings page only), with buttons **Print poster**
  (A5/A4: clinic name, logo, "Scan to check in", the short URL under the QR) and **Download PNG**.
- One QR per branch when the clinic has branches.
- The clinic website keeps **Book appointment** (remote, → `/book`, which now collects the same details, §8).
  The poster QR is for in-clinic use. The same page also shows the `/book` link with a copy button, for clinics
  that use their own website.

## 6. PIN code lookup
- `GET /api/v1/public/pincodes/{pin}` → `{pin, district, state, places: [string]}` (places = post office names,
  up to 30, for a "Locality" suggestion). `404` for unknown, `400` when not 6 digits starting 1–9. No auth, no
  host needed. `Cache-Control: public, max-age=2592000`. Throttled per IP.
- Data: India Post "All India Pincode Directory" (data.gov.in, Government Open Data License – India). It is shipped as
  a compressed file embedded in the server binary (about 150 KB gz), parsed once (`OnceLock`) into a map. There is no
  third-party call at runtime, so the patient's PIN never leaves our server. A `scripts/` tool regenerates it and
  records the source and date.
- Shared web component `PinCodeFields` (`@aarogyam/app-kit` or `site-kit`): typing the 6th digit looks it up,
  fills city/district/state (still editable), and offers locality suggestions. It is used in `/arrive`, `/book` details,
  the patient edit form, the walk-in sheet (when shown), and clinic setup and Settings → Profile (§1 founder ask).

## 7. Patient address (additive)
`patients.address jsonb` already exists (0012) but the API does not expose it. Add `address?: {line1?, locality?,
city?, district?, state?, pincode?}` to the patient view, create, edit and walk-in bodies (all optional; pincode
validated like the clinic pincode). The patient profile shows it with the PIN autofill. The mobile apiModels
allowlist gains `PatientAddress` (mobile owns the wiring).

## 8. API (all additive)
Public (clinic from host; a `404` when the clinic is closed or `self_check_in` is off):
- `GET /api/v1/public/arrive` → `{clinic_name, logo?, enabled, reasons: [{code,label}], health_flags:
  [{code,label}], notice_url, branches?: [{id,name}]}`.
- `POST /api/v1/public/arrivals` body `{branch_id?, for_self: bool, contact_name?, relation?, first_name,
  last_name, phone, reasons: [code], reason_text?, consent_care: true, email?, sex?, age_or_dob?, address?,
  health: [code], allergies_text?, reminders: bool, website?: ""}` → `201 {receipt}`. The `website` field is a
  honeypot: when it is filled, the API returns 201 and stores nothing.
- `GET /api/v1/public/arrivals/{receipt}` → `{status: pending|accepted|dismissed|expired, token_label?}`. Nothing
  else. The receipt is 32 random bytes in base64url; only its SHA-256 is stored.
- `GET /api/v1/public/pincodes/{pin}` (§6).

Staff:
- `GET /api/v1/arrivals` (patients.read) → pending requests, each with `matches: PhoneMatches`.
- `POST /api/v1/arrivals/{id}/accept` (patients.write + appointments.write) body `{patient_id?, check_in: bool,
  practitioner_id?, apply: [field]}` → `WalkInView` (reused). Idempotency-Key honoured like walk-ins.
  `409 already_handled` when someone else accepted it.
- `POST /api/v1/arrivals/{id}/dismiss` → 204.

Online booking: `NewBooking` gains optional `details: {sex?, age_or_dob?, address?, reasons?, health?,
allergies_text?, reminders?, consent_care?}`, saved on the self-registered patient in the same transaction (fill
blanks only on an existing record). `/book` gains the same optional Screen 2 after the slot is booked ("Save time
at the clinic — add details"), skippable.

## 9. Data
Migration 0759 `self_check_ins` (in schema `aarogyam`, RLS by org like every clinic table):
`org_id, id uuid default app.uuid_v7(), branch_id?, receipt_hash bytea unique, status text check in
('pending','accepted','dismissed'), payload jsonb (the submitted fields, validated), patient_id?, token_id?,
created_at, handled_at?, handled_by?`; PK (org_id, id); index (org_id, status, created_at).
- Ephemeral: pending rows older than 24 h and handled rows older than 7 days are deleted by the existing periodic
  sweep (or outbox job). The erasure step deletes rows whose patient_id is being erased.
- Public insert path: the API runs as the clinic (host-resolved), the same way `/public/bookings` writes its patient,
  never as a signed-in user.

## 10. Abuse and safety
- Throttles: per IP 6 submissions / 10 min; per clinic 120 / hour; per phone 3 / hour; status polling 1 per 5 s
  per receipt. 429 carries Retry-After.
- Body ≤ 8 KB; every text field length-capped and passed through `clinical_text`; names through `PersonName`.
- The pending list caps at 200 per clinic (the oldest drop off). The QR is meant for in-clinic use, and the desk
  confirms each one, so a remote spammer only fills a list the desk can clear with Dismiss.
- Minors: a patient under 18 entered under "Me" gets a gentle prompt, "Is a parent filling this?" It is a
  suggestion, not a block. The desk verifies.
- Logs: events carry `self_check_in_id`, `clinic_id`, outcome. They never carry names, phones or reasons.

## 11. Phones (mobile session, after the web lands)
The desk list and accept go into the phone app's queue (same endpoints), and the Settings QR shows there too.
New nested schemas need the apiModels allowlist: `ArrivalRequest`, `ArrivalAccept`, `PatientAddress`,
`PincodeInfo`, plus the booking `details` schema.

## 12. Build slices
- **S1 backend**: 0759, public arrive/arrivals/status, staff list/accept/dismiss, pincodes endpoint + data
  file, patient address, booking details, settings flag, sweep, erasure, OpenAPI, tests.
- **S2 web**: `/arrive` page, `PinCodeFields`, queue strip and sheet, Settings QR page (print/PNG), `/book`
  details step, patient address on the profile/edit, PIN autofill in clinic setup/profile. Fake client first.
- **S3**: deploy, demo QR on review clinic, mobile contract.

## 13. Open questions (defaults chosen; founder may change)
- Desk confirmation (chosen) vs auto-create patients. We auto-create nothing.
- Email optional (chosen) on the QR. Online booking still verifies email by code.
- One QR per clinic (per branch if branches) — no rotating codes (posters can't rotate).

## 14. v1 after adversarial review (overrides the sections above where they differ)
1. **QR key.** The QR URL is `/arrive?k=<key>`. The key is 128 random bits per clinic, stored hashed in settings
   and rotated with "New QR" in Settings, which voids old posters. The public GET and POST check the key and the
   `self_check_in` flag before any write; a wrong or missing key gets `404`. When the pending list is full (200),
   the API refuses new rows (`429 list_full`) and never drops old ones. The key is a capability, not patient data,
   so it is allowed in the URL.
2. **Throttles.** Per IP 20 / 10 min (clinic Wi-Fi and CGNAT share IPs), using the edge's trusted client IP. The per-clinic
   (120/h) and per-phone (6/h) rules use the Postgres throttle store, so they hold across instances.
3. **Accept permission** = `patients.write` + `appointments.write` + `intake.write` (what `walk_ins::register` needs).
4. **One transaction.** Split `walk_ins::register` into a `register_in(tx, …)` that takes a transaction. Accept does
   `SELECT … FOR UPDATE` on a pending row, then registers, records consents, and marks the row handled in the same
   transaction. A second accept gets `409 already_handled`.
5. **Family.** No `family_of` link from the public form. The contact name and relation are stored on the
   request and shown to the desk; on accept they become a patient note ("Registered by <name>, <relation>"). The match
   list defaults to **New patient** and shows the submitted name beside each match.
6. **Consent.** The request stores the notice version shown, who agreed (`self`, or `contact` + relation) and when.
   On accept, the `care` consent (and `reminders` if ticked) is recorded with method `app`, that notice version,
   `recorded_by` = the accepting member, and a note "given on the check-in form by <self|guardian>". For a patient
   under 18, the consent is recorded as the guardian's. On accept or dismiss the payload is cleared at once; only
   ids and status stay, deleted after 7 days.
7. **Sweep.** A new job `self_check_in_sweep`, on the existing periodic worker pattern (`task_jobs` / outbox tick),
   deletes pending rows older than 24 h and handled rows older than 7 days. It has a test.
8. **Contract.** `reasons`, `health` and `relation` are plain strings validated against specialty data on the server
   (not zod enums). Age and date of birth are separate (`age_years?`, `date_of_birth?`). Sex values are the API's
   existing ones.
9. **Friction.** Last name is optional. Required fields: first name, phone, one reason, the care consent.
10. **Cut from v1:** receipt and status polling (the done screen just says "take a seat"), so no honeypot receipt is needed and
    the honeypot just returns 201; place-name suggestions (PIN gives district + state only; city = district,
    editable); per-branch QRs; ticking changed values (they are shown only); "Register only"; PNG download (Print
    only); the `/book` details step (its own later slice, demographics only).
11. **PIN data** credits the source (GODL) in the app's About/licences text and in `crates/aarogyam-domain/data/PINCODES.md`.
