# Backlog

Requests from the founder and clinics that are not built yet. Read this before designing a change: a decision made now should not block an item here. Move an item to `delivery-plan.md` when it is scheduled, and delete it here when it ships.

## Dental chart

### Clinic list upkeep (6 Oct 2026, follow-up)
- Built: procedures and materials per surface on one or several teeth (seeded in `specialties/dental/vocabulary.json`, clinic additions in `dental_terms`), type-ahead and "Add new" on web, Android and iOS, and oval compact charts in the website demo.
- Still to do: retiring or renaming a clinic's own term (the table is append-only today), and a settings screen listing the clinic's additions.

## Today dashboard visuals (6 Oct 2026)
- Chair utilisation over time (per chair, per day and week).
- Patient mix: by age band, new vs returning, and by doctor.
- **Design note:** computed by one report query per tile in the existing round-trip budget (see `crates/aarogyam-api/tests/round_trips.rs`); no per-chart request fan-out.

## Photos and files from the phone and laptop (6 Oct 2026) - built
- **Built:** an optional `label` (up to 60 characters; presets OPG, Intraoral - upper/lower, X-ray, Consent, or the clinic's own) and the existing `tooth` on each attachment (migration 0190); the web Files tab uploads with both and shows a gallery grouped by label, and the chart's tooth panel lists that tooth's files; the apps take a photo (system camera, no permission on Android) or pick one (photo picker, `PhotosPicker`), choose label and tooth, shrink it on the device (longest side 2048 px, JPEG 85, EXIF dropped) and send it through the API with a client id, so a retry never duplicates it.
- **Rules kept:** uploads need `clinical.write`; viewing follows own/assigned scopes; previews use five-minute signed links, never a bucket address; storage keys are ids; screenshots stay blocked.
- **Not yet:** DICOM and PDF from the phone, an offline upload queue, annotations.

## Patient notes on Patient 360 (6 Oct 2026, built on feat/patient-notes)
- **Built:** `GET /api/v1/patients/{id}/notes` (summary note plus the visit notes, newest first) and `PUT /api/v1/patients/{id}/summary-note` (`If-Match`, audited); a Notes tab on Patient 360 web and mobile. Text is a strict Markdown subset (`#` to `###`, `-` and `1.` lists, `**bold**`, `*italic*`): validated on save (`aarogyam-domain/src/richtext.rs`, mirrored by the editors), rendered by trees (React elements, Compose text, SwiftUI attributed text), never as HTML. Visit note sections and addenda use the same format; older plain text is still valid.
- **Rules kept:** drafts are edited by their author, signed notes change only through addenda; the summary note is edited by anyone with `clinical.write` whose scope reaches the patient (`own`/`assigned` narrow it like other patient-level records).
- Show the patient's notes on Patient 360 (web and mobile), and let the doctor edit them during an ongoing visit or at any time they're allowed to.
- **Formatted** text: headings, bullet lists, bold; stored as a safe, structured format (e.g. Markdown with a strict renderer, or a small JSON document model), never raw HTML.
- **Design notes:** signed notes are immutable and change through addenda (already the rule: `/notes/{id}/addenda`); "edit" applies to drafts and to a patient-level summary note that is versioned (row_version / If-Match).

## Bringing in a clinic's existing records (6 Oct 2026)
Very important for onboarding: many clinics keep **paper case sheets**; others have spreadsheets or another system's export.
- **Paper:** photograph or scan case sheets (phone or scanner), then extract the fields automatically (OCR plus a model that maps any template to our fields), whatever the clinic's layout.
- **Files:** CSV, Excel and other exports, with columns mapped automatically from their names and contents (a suggested mapping the clinic confirms), not a fixed template.
- **Missing required data:** import what is present; mark records "incomplete" with exactly what's missing; let the clinic finish them later (front desk sees a to-do list). Never invent values.
- **Review before it counts:** every automatic extraction is shown for confirmation (side by side with the scan) before it becomes a clinical record; the original scan is kept as an attachment.
- **Exists:** smart file import (CSV in any delimiter or encoding, Excel `.xlsx`): automatic mapping from headers in English, Hindi and Marathi and from the values, remembered per clinic; lenient rows with a front-desk to-do list for missing details; duplicates by phone and name, skipped or merged; preview, then one idempotent commit with file, sheet and row kept (`/api/v1/imports/sessions`, web Patients → Import and Patients → Missing details; see `decisions.md`, 2026-10-06). The older CSV-text endpoint `/api/v1/imports/patients` remains.
- **Still to build:** the paper path (designed in `decisions.md`, 2026-10-06), keeping the original file as a clinic attachment the clinic can delete, and importing balances as opening bills.
- **Design notes:** extraction runs as a background job (outbox-style), never in the request path; the AI provider must meet the health-data rules (no training on our data, India data residency where required; see `docs/guidelines/`); imported records keep their source (scan id, file and row) for traceability.

## Moving between clinics and sign-in polish (6 Oct 2026)
- **Clinic switcher in the portal (built, feat/central-signin):** people who belong to several clinics switch from the top bar or account menu, without going back to the website (lists `/me` clinics; switching uses the same one-time handoff to the other clinic's host).
- **Console shows address progress live:** "Address pending" updates to "ready" without a manual refresh (the outbox job provisions it within ~2 minutes, before the invitation email goes out).
- **Handoff lands on Today directly (built):** instead of passing through the clinic's `/sign-in` route.
- **Clinic addresses are an implementation detail:** people sign in on the website and never need to type a clinic's address; keep it out of emails and screens except where a clinic shares a booking link.

## Support access for Sakalya staff (6 Oct 2026)
- `support_grants` exists only in the docs model, not as a migration. Build it: a clinic owner (or an approved request) grants a named staff member time-limited access to their clinic, visible to the clinic, audited, and ending automatically. Platform staff can't hold clinic memberships (migration 0172), so this is the only way for staff to help inside a clinic.

## One admin doctor across several clinics (6 Oct 2026)
- An owner (admin doctor) of several clinics manages staff across all of them in one place: who has access to which clinic and with which role; grant or remove access to another clinic without switching clinics.
- **Rules (already true per clinic, keep them):** access only by invitation per clinic; a person sees only clinics they belong to (picker, switcher, API 404 otherwise); money stays owner-only by default (`finance.view`, `billing.read`), changed only by the owner in Roles & access.
- **Design notes:** a clinic group (owner's organisation spanning clinics) with its own owner role; cross-clinic actions are invitations/memberships in each clinic underneath, so per-clinic RLS and audits are unchanged.

## Mobile sign-in with a password (6 Oct 2026)
- The staff apps offer only the email code; add "Use a password" like the website (same Supabase password sign-in, 12+ characters), and later the handoff from the website for one sign-in across web and phone where it helps.

## Contacting patients (6 Oct 2026)
- From a patient (web and mobile): **Call** (phone dialler) and **WhatsApp** (opens a chat with the patient's number), logged on the patient's timeline without message content.
- **Templates:** appointment reminder, follow-up, birthday, festivals and new year, plus **custom** text; placeholders (name, clinic, date) filled safely.
- **Campaigns:** choose all, active, or filtered patients (last visit, treatment, age, birthday month) and send an offer, camp or greeting; opt-out honoured, quiet hours, preview and count before sending, delivery report.
- **Design notes:** WhatsApp Business API (Meta-approved templates for outbound) and SMS via the notification service and outbox (AGENTS.md rule 10, never direct from handlers); consent and opt-out stored per patient (DPDP); campaigns need a permission, rate limits and an audit; costs per message shown before sending.

## Analytics tab (6 Oct 2026)
- A dedicated Analytics area for the owner/admin doctor (not staff), on web and the same on mobile. The founder will share a dashboard mock-up; plan from that, review, then build.
- **Design notes:** owner-only by default via a new permission; one query per chart within the round-trip budget; respects scopes.
- **Backend built (7 Oct 2026):** `analytics.view` (owner), `GET /reports/analytics` (chair utilization, income, expenses with stock as material, new vs returning, age band, visit kind, referral source, busy hours; one statement), and expenses (`expenses.write` for owner and finance; `GET/POST /expenses`, `POST /expenses/{id}/void`). Rules in `decisions.md`, "Analytics: chair utilization and material costs". Still to build: the portal Analytics page and Billing → Expenses tab, mobile, clinic opening hours (utilization assumes 9 h a day), custom expense categories, branch/vendor/receipt on expenses.

## Referral programme (later)
- Clinics refer other clinics and earn a discount (e.g. 10–50% of the next month) when the referred clinic subscribes; tracking codes, a referrals page, and terms to decide with pricing.

## Look and feel: make it impressive (6 Oct 2026)
- The current UI looks dull. The founder will share screenshots of what they expect. Empty states must still look alive (illustrations, sample previews, next steps), never bare boxes.
- **Sign-in and landing pages** should show what Aarogyam is (product visuals, value), not just sign-in boxes; see how MyDwarpal handled it.
- Review the whole portal and both mobile apps against the new direction before building more screens.

## Simplify navigation (6 Oct 2026)
- **Staff vs Settings:** both exist in the sidebar; decide one place (likely Settings → Team & roles, with clinic settings alongside) and remove the duplicate.
- **Prescriptions page:** drop the clinic-wide Prescriptions page; prescriptions live on the patient's Rx tab (history paginated, "New prescription" there). Keep a clinic-wide list only if a real workflow needs it (e.g. a pharmacy hand-off queue).

## Pharmacies (later)
- A pharmacy app or dashboard: the doctor sends a prescription to a chosen pharmacy; the patient shows a QR code or screenshot to collect; later, payments. Builds on the existing prescription verify page and QR.

## Other specialties (planning)
- Today the product is dental-first. Plan specialty packs for general practice (MBBS), gynaecology, ENT, paediatrics and others as data (AGENTS.md rule 11): forms, vocabularies, templates and charts per specialty; a clinic can have several.

## Patient app follow-ups (7 Oct 2026, after v1 on feat/patient-app)
- **Phone sign-in:** OTP by SMS needs a paid provider and DLT registration; email codes only until then.
- **Self sign-up:** Supabase sign-ups are off, so only patients a clinic invited (or who exist already) can sign in; a throttled, Turnstile-checked patient sign-up would let a patient ask for a match first.
- **Scan the QR in the app** (camera), and open the app from an emailed link (app links on the product domain).
- **File viewer:** the app lists shared files; viewing images and PDFs in the app, and patients uploading old reports.
- **Patient session registry:** patient sessions aren't in `sessions`, so they can't be listed or revoked from the app yet (staff revocation of the same Supabase session still applies).
- **Family profiles** (one account, several records), push reminders (no health data in payloads), "who viewed my record" from `access_log`, doctor-approved visit summaries (D3).
- **Move generic mobile code to sakalya-mobile:** the email-code sign-in holder, `ScreenError` and host config are copied between the staff and patient apps.

## One patient across clinics (planning, important)
- Today each clinic's records are isolated by design (row-level security per clinic): a patient who sees Doctor A and then Doctor B at another clinic has two separate records, and Doctor B cannot see Doctor A's dental chart.
- **Direction:** sharing only with the patient's consent: a patient-owned record (the Aarogyam patient app and/or ABDM/ABHA consent artefacts) where the patient grants Doctor B's clinic access to selected history (e.g. the dental chart), time-limited and revocable, audited on both sides. Never automatic sharing by phone number match.
- **Design notes:** findings already reference vocabulary ids and carry dates and clinicians, which makes a shareable, structured summary possible; ABDM identifiers are already on the review follow-up list.

## Privacy and compliance follow-ups (7 Oct 2026)
- **Optional MFA for clinic users** (owner and doctors), reusing the console's authenticator step; a clinic setting could later make it required for roles that see finance or export data.
- **Erasure and anonymisation** as designed in decisions.md (Retention): legal-hold flag, per-clinic retention override, the erase job with `--apply --clinic`, scrubbing `audit_events.changes`, and an erasure log replayed after a restore.
- **Consent drives messaging:** withdrawing `reminders` or `promotional` consent should switch off those messages (link `patient_consents` to `consent_channels`); patient self-service consent in the patient app; clinic-authored notice text with versions instead of a free label.
- **Legal pages for clinics' own use:** clinics' own notice printed with the clinic's letterhead; lawyer-reviewed Hindi and Marathi versions.

- **Built so far (7 Oct 2026):** the patient account and verified per-clinic links, and the patient app showing every linked clinic's appointments, prescriptions, bills and shared files together (`docs/patient-access.md`, "Built"). Still to build: a patient granting one clinic access to another clinic's history (consent artefacts, time-limited, audited both sides).
