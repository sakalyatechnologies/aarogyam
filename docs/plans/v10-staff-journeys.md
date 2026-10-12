# v10: assistant and doctor journeys on the phone (plan, draft for review)

Founder request, 11 Oct 2026. The phone must carry the whole clinic day for two people:
- the **assistant or front desk:** intake, queue, collect, tasks
- the **doctor:** send in, consult, chair, chart, Rx, finish

Notifications must run both ways so the two never disagree. Targets:
- **assistant:** returning patient checked in within 3 taps after typing the number
- **doctor:** Wrap up done in under 60 s of screen time

**Status:** draft. It needs approval from an independent senior principal engineer before any build starts.

## 0. Ground truth and ownership
- **The website is the reference.** It already runs this flow on main:
  - `web/apps/portal/src/pages/queue/*`: walk-in wizard, add to queue, chair dialog, collect dialog, board
  - `pages/patients/v2/*`: Patient 360 blocks, visit session, finish-visit, collect panel, celebration, images
  - `today/v2/my-tasks.tsx`
  
  The phone calls **the same endpoints** with the same rules (`finish-visit.ts` is copied in behaviour, not code).
- **Backend:** main's versions are canonical. The v9 extras are being ported on `feat/v9-port` (pa: family and payment proof; pb: SSE, auto messages, recall dismiss).
- **Ownership, to avoid merge conflicts:**
  - This session owns `mobile/**` and `docs/plans/v10*`.
  - The web and backend agent owns `web/**`, `crates/**` changes beyond the pa/pb ports, and migrations 0600–0699.
  - Backend gaps found here go to [v10-gaps.md](v10-gaps.md) for that agent. Mobile never waits on them: each gap has a phone fallback below.
- **Already on the phone (v9, feat/v9):**
  - desk lookup by number and family profiles
  - waiting board with Send in
  - payment sheet with proof photo
  - patient Overview, History and Consent
  - visit screen with timer, dictation, inline Rx, procedures and close
  - offline outbox (iOS and Android)
  
  v10 reshapes these into two role homes and fills the holes. Nothing is rebuilt from scratch.

## 1. Assistant / front desk journey
| Step | What the phone shows | Taps | API |
|---|---|---|---|
| A1 Home | **Desk** tab first for front desk and assistant: number field focused with keypad up; the availability strip; today's board; a "My tasks" strip with the open count | 0 | `/today` (chairs, team, shifts), `/queue`, `/tasks/mine`, `/me/badges` |
| A2 Lookup | Type 10 digits, auto-search (no button), then profile chips for everyone on the number, children grouped under the parent | 0 | `POST /patients/lookup` (+ `family_group` after pa) |
| A3 Returning | Tap a profile, then one card: last visit, allergies, plus **"Check in · Dr X"**. The doctor is prefilled as the free doctor, else the last doctor; a chip changes it | 2 | `POST /walk-ins` with `patient_id`, `practitioner_id` (or the appointment check-in) |
| A4 New | **"New patient"** opens one scrolling form: name, date of birth or age, phone (prefilled), email (optional), sex, allergy chips (must pick "none known" or some), consent toggles read aloud, **signature pad**, photo (optional), "Reason for visit" note; one **Save & queue** button | form + 1 | `POST /walk-ins` (allergies, consents, notice), then the outbox uploads the photo and the signature as attachments (`photo` "Profile", `consent` "Signature") |
| A5 Child | "Add family member" on a parent creates the walk-in with `family_of` | form + 1 | after pa |
| A6 Availability | Strip at the top: each doctor **free / with patient / away**, each chair **free / busy**, derived from `/today` + `/queue` (no new call) | 0 | — |
| A7 Waiting | The card shows "Waiting for Dr X · 0:42". At **60 s** with no `called`, it turns amber: "No reply" with **Remind** and **I'll check**. Remind re-notifies the doctor (G1); until G1 ships, the fallback posts "Token 12 is waiting" (no name) in the team chat to the doctor | 1 | G1 / `postMessage` |
| A8 Welcome | A chip on the card, "Welcome sent" / "Not sent: no WhatsApp consent", from the server's auto message (pb) | 0 | message status (pb; G8 if missing) |
| A9 Send in | The doctor's call arrives (SSE, or a poll), then a banner, haptic and sound: "Dr X is ready for Token 12". The card moves to Called; "Sent in" moves it on | 1 | `/queue/{id}/status` |
| A10 Collect | `collect_payment` arrives, then a banner, then a To pay card with the amount. The sheet has the amount prefilled, UPI QR (`/invoices/{id}/upi-link`) / cash / card, proof photo and **Paid**. Then a celebration, the token goes done, and the server sends the thank-you | 2–3 | `POST /payments` (+ `attachment_id` after pa), issue invoice |
| A11 My tasks | Today's tasks, overdue first. **Done** opens an optional note and **proof photo** (G4), then confetti and the row leaves. `record_usage` gets an item and quantity picker or "nothing used"; `confirm_photos` shows `patients_without_photos_today` | 1–2 | `/tasks/mine`, `/tasks/occurrences/{id}/complete` |
| A12 Bell | All notification kinds, including `task_*`, `time_off_*` and `stock_alert`. Unknown kinds show a generic row and never crash | — | `/notifications` |

## 2. Doctor journey
| Step | What the phone shows | Taps | API |
|---|---|---|---|
| D1 Today | A **"Waiting for you"** card at the top, with token, age/sex, reason, allergy flag and wait time. New arrivals bring a banner and haptic. **Send in** is one tap | 1 | `/queue?practitioner_id=me`, `POST /queue/{id}/call` |
| D2 Patient | Opens with an **intake summary** on top: reason, allergies, consents, photo, family, last visit; then the Overview teeth chart, treatments done, X-rays, and the visit history (as Patient 360 v2) | 0 | as v9 (one request per screen) |
| D3 Start | **Start visit** sets the token to in_consult and starts the timer | 1 | `POST /queue/{id}/start-visit` |
| D4 Consult notes | **Dictate** (en/hi/mr): live transcript, saved as bullets automatically; Write field; quick picks (complaint / finding / advice) | 1 per item | notes create, then PATCH |
| D5 Chair mode | One toggle sets the token in_chair and shows a **big-target screen**: Dictate (hands-free start and stop), **Photo** (camera opens, each photo uploads to the visit through the outbox automatically), tooth number chips. Everything autosaves | 1 + per photo | `/queue/{id}/status` in_chair (+ room), attachments |
| D6 Chart | Tap a tooth: treatment form with procedure, **surfaces M/O/D/B/L**, **material**, finding, done or planned (the existing ChartStateHolder + ToothSheet, restyled to web parity) | 3–4 | `/chart` record, `/visits/{id}/procedures` |
| D7 Rx | Inline Rx with M/A/N, food timing and days; **medicine sets** (main 0626); allergy swap | 2+ | prescriptions + medicine sets |
| D8 Wrap up | One sheet with: follow-up chips (1w, 2w, 1m, 6m, none); fee prefilled from the visit's priced procedures and editable; "Issue Rx" (on by default when there's a draft); then either **Collect now** or **Send to desk**. One `POST /visits/{id}/finish` call; `queue_status` is `done` (Collect now records the payment first) or `ready_to_bill` (sends `collect_payment` to the desk). A 409 `allergy_alerts` asks for the override reason and retries | 2–3 | `/visits/{id}/finish`, `POST /payments` |
| D9 Done | Celebration: "Visit closed · Rx sent · follow-up 18 Oct · desk asked for ₹800". The share link status is from `FinishedVisit.share` | 0 | — |

**60 s check:** D1 (1) + D3 (1) + D8 (3) = **5 taps** of flow overhead. Clinical entry (notes, chart, Rx) is the doctor's own time. The E2E run in §5 times it.

## 3. Notifications, both ways (no mismatches)
| Event | To | Delivery today | Later |
|---|---|---|---|
| Patient queued (`patient_waiting`) | that doctor | SSE, then banner, haptic and badge; poll fallback | push (G3) |
| No reply in 60 s | desk | phone timer on the card | server re-notify (G1) |
| Doctor called (`send_in`) | desk | SSE, then banner and sound | push |
| Collect (`collect_payment`) | desk | SSE, then banner | push |
| Task due or escalated | assignee | bell, plus My tasks badge | push |
| Patient messages (welcome, thank-you) | patient's WhatsApp | server auto messages (pb) | live Meta account |

**One source of truth:** every screen reads the queue token state from the server. The phone shows state only after the server confirms it. Outbox writes show a "Saved, will send" badge and never claim done. Background: iOS can't keep SSE alive, so the app refreshes everything when it comes to the foreground. Real push waits for credentials (G3).

## 4. Tasks: each has one owner and its own files (Sonnet workers, at most 3 at once)
| # | Task | Owns | Depends on |
|---|---|---|---|
| T0 | **Retarget to main** (me): merge feat/v9-port + feat/v9; regenerate models; `CloseVisit`→`finish`, `VisitShare`→`VisitLink`; gates | merge | pa, pb |
| T1 | Shared `RoleHome`: which home per role (Desk first for front desk and assistant, Today with Waiting for you for doctors); NavModel tests for 6 roles | `shared/.../nav/*` | T0 |
| T2 | Shared `AvailabilityStrip` model from `/today` + `/queue` (doctor free / with patient / away; chair free / busy) with tests | `shared/.../desk/Availability*.kt` | T0 |
| T3 | Shared `IntakeForm` holder: one-form new patient (validation, allergies required, consent, signature and photo queued in the outbox after create, `family_of`, reason note) | `shared/.../walkin/Intake*.kt` | T0 |
| T4 | Shared `DoctorWaitTimer` + Remind (G1 if present; else the team-chat fallback with no name) | `shared/.../desk/Remind*.kt` | T0 |
| T5 | Shared `FinishVisitStateHolder` mirroring web `finish-visit.ts` (follow-up chips, fee prefilled from priced procedures, Rx issue, allergy 409 retry, collect now vs send to desk) | `shared/.../visit/Finish*.kt` | T0 |
| T6 | Shared `MyTasksStateHolder` + `NotificationKinds` (all main kinds, unknown tolerated) + badges | `shared/.../tasks/*`, `shared/.../notifications/*` | T0 |
| T7 | iOS **Desk home**: number field, chips, availability strip, board with timer and Remind, banners | `Screens/V10Desk/*`, `Routes+V10Desk.swift` | T1–T4 |
| T8 | iOS **Intake form** + **signature pad** (PencilKit) + photo | `Screens/V10Intake/*` | T3 |
| T9 | iOS **Doctor**: Waiting for you card; intake summary on the patient; **chair mode**; Wrap up sheet; celebration | `Screens/V10Doctor/*` | T5 |
| T10 | iOS **My tasks** + proof photo + confetti; bell kinds | `Screens/V10Tasks/*` | T6 |
| T11 | iOS live-update banners and haptics on SSE events (after the sse worker) | `Screens/V10Live/*` | sse |
| T12 | E2E (me): two simulators (desk + doctor) against the local API, the whole journey timed; screenshots SE and Pro Max, light and dark | `docs/plans/v10/e2e/*` | all |
| T13 | Android: the same screens, after iOS sign-off (separate plan) | `androidApp/**` | T12 |

**Rules for every worker:**
- Each worker works in its own worktree and branch `v10-<task>` and writes a handoff `docs/plans/v10/<task>.md`.
- Strings in en/hi/mr in a per-area string table.
- XCTests and commonTest.
- No patient names or clinical data in logs or notifications.
- Gates: `./gradlew check` + `ios-check.sh`.
- Workers never edit `web/`, `crates/`, `db/` or the shell files except by adding lines.

**Order:**
1. T0
2. T1–T6, three at a time
3. T7–T11
4. T12

## 5. Done means
- **The E2E script passes** on two simulators:
  1. lookup
  2. new child under a parent
  3. queue
  4. the doctor gets the banner
  5. the 60 s amber state
  6. Send in reaches the desk
  7. the visit: dictate, chair photo, tooth with surface and material, Rx
  8. Wrap up with Send to desk
  9. the desk gets Collect, records UPI with proof
  10. the token goes done
  11. thank-you in the fake provider log
  12. the task completed with confetti
- **Timings recorded:** desk returning check-in ≤ 3 taps; doctor overhead ≤ 5 taps, under 60 s.
- **All gates green.** Then push to main and report the screenshots to the founder.

## 6. Risks
- **The backend changes under us:** the web agent is active on main. Mitigation: merge main daily, keep the backend port small, use 0700+ migrations.
- **No push in background:** foreground refresh plus SSE only until G3. The desk must keep the app open, which matches desk use.
- **Signature as legal consent:** stored as an attachment linked to the consent; the legal wording stays the web's notice version.
