# Backlog

Requests from the founder and clinics that are not built yet. Read this before designing a change: a decision made now should not block an item here. Move an item to `delivery-plan.md` when it is scheduled, and delete it here when it ships.

## Dental chart

### Clinic list upkeep (6 Oct 2026, follow-up)
- Built: procedures and materials per surface on one or several teeth (seeded in `specialties/dental/vocabulary.json`, clinic additions in `dental_terms`), type-ahead and "Add new" on web, Android and iOS, and oval compact charts in the website demo.
- Retiring, renaming and listing a clinic's own terms: backend built 8 Oct (decisions.md). Still to do: the settings screen.

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
- Backend built 8 Oct (decisions.md, "Support grants"): owner grants, revokes, per-request audit, console list, read-only access on the clinic host. Still to do: the portal Settings screen and the console screen, and a request-and-approve flow.

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

## Clinic notifications for online bookings (8 Oct 2026, important)
Founder testing: a patient booked online from the clinic website and the booking appeared on the calendar, but nobody at the clinic was told. The bell in the top bar is a placeholder; it always says "You're all caught up".

**Who sees it**
- **Every member who handles appointments** sees each notification, not just whoever is on duty. If the assistant misses one, the doctor or front desk still sees it.
- **Read state is per person.** Each notification also shows whether it has been handled ("Confirmed by Farah, 10:42") and by whom, so two people don't call the same patient.

**Where it shows**
- **Portal:** the bell shows an unread count and a list. Each item opens its appointment.
- **Staff phone app:** push notification to the assistant, the front desk and the doctor. The push payload carries IDs only, never patient names (AGENTS.md rule 6). The app shows the same list.
- **Inbox (Messages):** an inbox message per booking, so it stays visible until someone handles it rather than disappearing like a toast.

**Reminders and escalation**
- If a booking is still unhandled after a set time (for example 15 minutes in opening hours), remind everyone again.
- After that, escalate to the owner.
- Unhandled bookings sit at the top of Today until confirmed or declined.

**Patient side**
- After booking online, the patient sees "The clinic will confirm shortly" instead of an instant confirmation, when the clinic chooses "wait for confirmation".
- **Later:** a WhatsApp (or SMS) message, "Sunrise Dental has your request and will get back to you within 1 hour", then the confirmation or decline. This goes through the outbox and notification service and needs WhatsApp Business templates (see "Contacting patients").

**Design notes**
- Notifications are written in the same transaction as the booking (outbox pattern) and store IDs only.
- Delivery: the portal checks every minute (no live connection to start with); the phone app gets FCM/APNs push through the notification service.
- A per-clinic setting decides between "confirm online bookings automatically" and "wait for confirmation" (the `requested` status already exists).
- Respects scopes: a doctor limited to their own patients sees only their bookings.

**Related fixes found in the same test (planned)**
- **Appointment window:**
  - fields out of line (hints above some boxes but not others)
  - the chair change is lost unless you press Move appointment
  - reason, visit kind and length can't be edited
  - no patient phone or email
- **Online sign-ups:** registered with name, email and phone only; complete age, sex, allergies and consent at Mark arrived, and also match duplicates by phone.
- **Date and time fields:** the shared `sakalya-web` date field is the browser default (US order, no shortcuts) and time is typed as text. Build a proper date picker and slot-based time picker there, then use it everywhere.

## Sign-in from the public website: one smooth step (8 Oct 2026)
- **Problem:** after signing in on the public Aarogyam website, several different screens flash by while it redirects to the clinic portal, and it takes a while. Today the path goes from the website's sign-in, through the handoff, then the portal's own loading screens ("Loading your clinics", "Opening the clinic"), then the setup gate, then the page.
- **Wanted:** one simple loader from the moment you press Sign in until the clinic page is ready. It should be the same full-screen, branded loader with one line of text, such as "Opening Sunrise Dental…", and no intermediate screens.
- **Design notes:**
  - Measure each hop first (website sign-in, handoff redemption, `/me`, `/session`, setup) and remove the ones that can be skipped or run in parallel.
  - Keep the one-time code and host binding as they are.
  - Make the portal's loading states share one component, so they show as a single steady loader instead of a sequence.
  - If something fails, show a clear error with "Try again" and a way back to sign in.

## Public website and sign-in look like two products (8 Oct 2026)
- **Problem:** the public Aarogyam website (Lovable design, kept as is) and the sign-in, registration and sign-out pages use very different colours and type, so clicking Sign in feels like landing on another site.
- **Wanted:** the sign-in, register and sign-out pages, and the loader above, use the public website's palette, typography and logo treatment. Then the clinic portal takes over with the clinic's own theme.
- **Constraint:** don't change the public landing page itself (founder decision); adapt the auth pages to it.
- **Design notes:** take the colours and fonts from the website's styles as tokens in `sakalya-web` (an "Aarogyam brand" theme), use them in the shared auth shell (`web/packages/auth`), and check light and dark.

## Outside UI review of the portal (8 Oct 2026)
Two walkthroughs of the live Sunrise portal (all tabs, then a Patients deep-dive). Verdict: coherent and close to production; fix the trust issues first. Status is noted per item.

**High**
- **Times at 1–3 am:** the calendar shows appointments at 1:15 am and 2:40 am, and the busy-hours heatmap shows "Mon 1a: 3 visits". Analytics already uses clinic time, so check whether the demo rows themselves sit at night (seed or refresh shifted in UTC) or the clinic's timezone setting is wrong. Fix the data or the cause; a dental clinic open at 3 am erodes trust. *(in progress)*
- **Partial-name search:** "pat" finds nothing although "Sneha Patil" exists. Search should match prefixes and parts of words. *(in progress)*
- **Phone search:** the hint promises "the last digits of the phone", but "9999" finds nothing. Make it work, or change the hint. *(in progress)*
- **Query strings leaking between pages:** Calendar's `?from&to` carries onto Queue and Today, and Analytics' `?months&by` onto Messages. Each page should own its own query string. *(in progress)*
- **Stock empty states:** two compete on one screen ("Start tracking your stock" and "No items yet"). Merge them into one guided card. *(in progress)*
- **New bill from a patient's Billing tab:** loses the patient. Pass `?patient=`, which the new-bill page supports since 8 Oct. *(in progress)*

**Medium**
- **Today hero:** says "Nobody else is booked today" next to "3/3 completed"; should read "All of today's appointments are done".
- **Team today:** lists the owner twice ("Asha Kulkarni, Owner" and "Dr Asha Kulkarni, Orthodontics"); the member and their practitioner profile should be one row.
- **Settings tabs:** nine tabs overflow at 1280 px, so Sessions is hidden. Wrap them or group them (see "UX review of settings").
- **Invoice chips:** both "Issued" and "paid" show; show one status.
- **Messages:** the campaign composer looks functional next to "Nothing is sent from here yet". Label it a preview or disable it.
- **Dental chart summary:** "with caries / restored / missing" show no counts; show 0.
- **Incomplete details page:** says every imported patient has their details, while patients with no age exist; list missing age too.
- **Record a finding:** preselects Caries on a sound tooth; default to nothing (or the tooth's current state). The dialog also has both Cancel and Close; keep one.

**Low**
- **Analytics numbers:**
  - Legend values read "3·38%"; show "3 (38%)".
  - Expenses and Net show blank instead of ₹0.
  - Chair-use meters show a bare number next to an average of 0%; label the unit.
- **Queue:** the "Longest wait" stat has no value when the queue is empty; show "—".
- **Recent patients table:** Treatment and Bill columns are mostly "—"; hide empty columns.
- **Patient breadcrumb:** shows "PATIENT 360"; show the clinic number (SD-14).
- **Cut-off sentences:** the patient-app invite ("…bills in the Aarogyam") and the Consent tab description ("…withdraw. Th").
- **Name case:** nudge names to title case on entry ("ram" → "Ram"), or display them that way.

## Analytics tab (6 Oct 2026)
- A dedicated Analytics area for the owner/admin doctor (not staff), on web and the same on mobile. The founder will share a dashboard mock-up; plan from that, review, then build.
- **Design notes:** owner-only by default via a new permission; one query per chart within the round-trip budget; respects scopes.
- **Backend built (7 Oct 2026):** `analytics.view` (owner), `GET /reports/analytics` (chair utilization, income, expenses with stock as material, new vs returning, age band, visit kind, referral source, busy hours; one statement), and expenses (`expenses.write` for owner and finance; `GET/POST /expenses`, `POST /expenses/{id}/void`). Rules in `decisions.md`, "Analytics: chair utilization and material costs". The portal Analytics page and Billing → Expenses tab were built on 8 Oct 2026. Still to build: mobile, clinic opening hours (utilization assumes 9 h a day), custom expense categories, branch/vendor/receipt on expenses.

## Referral programme (later)
- Clinics refer other clinics and earn a discount (e.g. 10–50% of the next month) when the referred clinic subscribes; tracking codes, a referrals page, and terms to decide with pricing.

## Look and feel: make it impressive (6 Oct 2026)
- The current UI looks dull. The founder will share screenshots of what they expect. Empty states must still look alive (illustrations, sample previews, next steps), never bare boxes.
- **Sign-in and landing pages** should show what Aarogyam is (product visuals, value), not just sign-in boxes; see how MyDwarpal handled it.
- Review the whole portal and both mobile apps against the new direction before building more screens.

## UX review of settings, setup and speed flows (8 Oct 2026)
Review prompts are in `~/project/ux-review/ux-review-prompts.md` (outside the repo), with 13 screenshots in `~/project/ux-review/screenshots/`. Paste the shared context, then one prompt with its listed screenshots, then the output-format block. Each prompt includes a proposed fix for the reviewer to critique. The roles screenshots predate the expenses and Analytics access rights.
- **Roles and permissions:** hidden role switching; locked roles don't explain themselves; "1 of 3" cells; 25 switches; confusing "Like X" buttons; staff and roles mixed together; very long on a phone.
- **Letterhead:** small preview that scrolls away; oversized thumbnails and switch rows; raw file input; Save easy to miss; no clear order.
- **Theme:** unclear which choice is active; no preview before applying; no undo; hex-only custom colour with no contrast check.
- **Settings structure:** nine tabs in one row; phone tab bar; mixed saving (instant vs Save button).
- **Setup "Your look" step:** the whole Theme and Letterhead screens stacked into one first-run step.
- **Speed review:** taps and decisions for a walk-in and a doctor's visit; family-shared phone numbers; where the quick picks sit; SOAP vs one box.

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
- **Patient session registry:** backend built 8 Oct (`patient_sessions`, `GET /me/patient/sessions`, `DELETE /me/patient/sessions/{id}`, refused on the next request). Still to do: the app screen.
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

## Phone screens in Marathi and Hindi (8 Oct 2026)
- **Built (machine-drafted):** the staff app's screens in Marathi and Hindi: Android `values-mr` and `values-hi` for every string file, `mr` and `hi` in the iOS String Catalogs. The app follows the phone's language; Android also has an in-app choice (Today → More → Language: phone setting, English, मराठी, हिंदी) through `AppCompatDelegate.setApplicationLocales`; iOS opens Settings, where each app has its own language.
- **Before the pilot:** a native Marathi speaker and a native Hindi speaker who know clinic work review every string (clinical terms such as caries, crown and the tooth surfaces are transliterated for now; dentists may prefer the English words), and check the screens for truncation. Until then the translations are drafts.
- **Not yet:** the portal (its i18n layer is part C4 of the walk-in plan), patient-facing text (prescriptions, the patient app), and a check that fails the build when a string has no Marathi or Hindi version on iOS (Android lint already does).
