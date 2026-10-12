# v10: assistant and doctor journeys on the phone (plan rev 2)

Founder request, 11 Oct 2026. The phone carries the whole clinic day for two people:
- **assistant / front desk:** intake, queue, collect, tasks
- **doctor:** send in, consult, chair, chart, Rx, finish

Notifications come from the one backend and are shown on both sides, so the two never disagree.

**Status:**
- Rev 1 was reviewed by an independent principal engineer: approve with changes, with 2 blockers and 9 majors.
- Rev 2 addresses every finding (R1–R16, marked inline). Rev 2.1 fixes the 7 re-review findings, marked "re-review N".
- Rev 2 needs that reviewer's approval before T0.

## 0. Ground truth and ownership
- **Single-backend rule.** Founder, 12 Oct; the full text is in `~/project/coordination/mobile-to-backend.md`.
  - One backend, owned by the backend and website agent (ref 541c34).
  - The phone **only displays** notifications. It adds no notification logic, kinds, tables or app-side substitutes such as chat nudges (R7).
  - Mobile's last backend change is **pb**:
    - 0702 SSE with Last-Event-ID
    - 0703 auto messages
    - 0704 follow-up link and `POST /recalls/{id}/dismiss`
    - payment → token done
  - pa is cancelled (R1). What it held moved to the backend:

    | Feature | Backend branch or gap |
    |---|---|
    | family | the backend's `feat/v2-patients` |
    | payment proof | `feat/v2-reports` |
    | `audience` / `handled` on notifications | `feat/visit-notify` |
    | patient visits | G11 |
- **The website on main is the behaviour reference.** It already runs this flow:
  - `web/apps/portal/src/pages/queue/*` and `pages/patients/v2/*` (`finish-visit.ts`, `collect-panel.tsx`, `intake-fields.tsx`, `chair-dialog.tsx`, `use-voice-notes.ts`)
  - `today/v2/my-tasks.tsx`
  
  The phone calls the same endpoints in the same order. The contract is `docs/api/openapi.json` on main.
- **Capability flags (R1).** These features ship behind flags that turn on when their backend field appears in the regenerated spec:
  - family (`family_of`, `family_group`)
  - payment proof (`Payment.attachment_id`)
  - notification `audience` / `handled`
  - walk-in `reason` (G6)
  - Remind (G1)
  - message status (G8)
  
  Until a flag is on, its UI is hidden; there's no fake substitute. **How the flags work (re-review 1):**
  - The flagged fields aren't in main's generated models yet. So the phone keeps small **hand-written DTOs** in `shared/.../config/caps/`, decoded with `ignoreUnknownKeys`.
  - Each `ServerCaps` flag is set **at runtime**, when its field appears in a real response.
  - A test against main's spec asserts that every flag is off today.
  - When a backend field lands, a follow-up switches that code to the generated model.
- **Ownership.**
  - Mobile owns `mobile/**` and `docs/plans/v10*`. It doesn't touch `web/`, `crates/` or `db/`.
  - The backend agent owns the gaps in `v10-gaps.md`.
- **Reuse, don't rebuild (R5).** Extend v9, which already has:
  - `V9Desk`: `DeskBoardScreen`, `DeskLookupScreen`, `DeskPaymentSheet`, `DeskV9Logic`
  - `V9Visit`
  - `V9Patient`
  - shared `desk/*`, `visit/*`, `walkin/*`, `outbox/*`
  
  New folders only hold genuinely new screens: intake form, tasks, chair mode, wrap up.

## 1. Assistant / front desk journey
| Step | What the phone shows | Taps | API |
|---|---|---|---|
| A1 Home | When the person has `queue.write` and lacks `queue.call`, the **Desk** home comes first (R13). It has a focused number field, the availability strip, the board (extends `DeskBoardScreen`), and a My tasks strip with the open count | 0 | `/today`, `/queue`, `/tasks/mine`, `/me/badges` |
| A2 Lookup | Ten digits trigger an automatic search, which shows profile chips; family grouping appears when the family flag is on | 0 | `POST /patients/lookup` |
| A3 Returning | Tap a profile to get a card with **"Check in · Dr X"**: the free doctor, else the last doctor; a chip changes it | 2 | `POST /walk-ins` with `patient_id`, `practitioner_id` (or the appointment check-in) |
| A4 New | **"New patient"** opens one form: name, DOB or age, phone (prefilled), email, sex, allergy chips (must choose "none known" or some), consent toggles read aloud, signature pad, optional photo, then **Save & queue**. **Online-only** (R3). Once `patient.id` is back, the photo and the signature are queued as `PatientFile` entries. The "Reason for visit" field shows only when the G6 flag is on (R7) | form + 1 | `POST /walk-ins`, then `POST /patients/{id}/attachments` (`photo` "Profile"; `consent` "Signature") |
| A5 Child | "Add family member" appears only when the family flag is on | form + 1 | `family_of` |
| A6 Availability | **Doctors:** free, with a patient, or away (from shifts, leave and tokens). **Chairs:** busy only when a token has a `room_id` or `ChairStatus.current` is set (R6). A walk-in with no room doesn't mark a chair | 0 | from `/today` + `/queue` |
| A7 Waiting | "Waiting for Dr X · 0:42" on an injected clock (R11). At 60 s with no `called`, the card turns amber with **"Check with Dr X"**; a **Remind** button shows only when the G1 flag is on | 0–1 | G1 |
| A8 Welcome | A message status chip, only when the G8 flag is on (R7) | 0 | G8 |
| A9 Send in | A `send_in` notification (SSE or poll) brings a banner ("Token 12 is called", no names, R12), a haptic and a sound. The card moves to Called. "Sent in" only acknowledges on this device and writes nothing, because start-visit seats the token (re-review 6) | 1 | — |
| A10 Collect | A `collect_payment` notification brings a To pay card. The sheet **re-GETs the invoice** for the current balance (R8), then: issue it if it's a draft, UPI QR / cash / card, the proof photo (when that flag is on), and **Paid**. Then a celebration. A 409 refetches and shows the server's state. The card closes when the notification is `handled` or the balance is 0 | 2–3 | `GET /invoices/{id}`, `POST /invoices/{id}/issue`, `/invoices/{id}/upi-link`, `POST /payments` |
| A11 My tasks | Overdue first. **Done** asks for an optional note (a proof photo once G4 lands), then confetti. `record_usage` gets an item picker or "nothing used"; `confirm_photos` shows `patients_without_photos_today` | 1–2 | `/tasks/mine`, `/tasks/occurrences/{id}/complete` (`client_id`) |
| A12 Bell | All kinds from main's contract, through the existing mapping, which moves from `DeskV9Logic.swift` into shared (R5). Unknown kinds get a generic row. De-duplicated by notification id (R8) | — | `/notifications` |

## 2. Doctor journey
| Step | What the phone shows | Taps | API |
|---|---|---|---|
| D1 Today | When the person has `queue.call`, a **"Waiting for you"** card: token, age and sex, the reason (G6 flag), an allergy flag, the wait. A banner on each new `patient_waiting`. **Send in** | 1 | `/queue?practitioner_id=`, `POST /queue/{id}/call` |
| D2 Patient | The intake summary on top (allergies, consents, photo, family when flagged, last visit), then Overview (teeth, treatments, X-rays) and History, as in v9 | 0 | as v9 |
| D3 Start | **Start visit**; the server seats the token (R6) | 1 | `POST /queue/{id}/start-visit` |
| D4 Notes | **Dictate** (en/hi/mr): live transcript saved as bullets, **and the audio uploaded** as `kind=audio` with `note_id`, `duration_seconds` and `language`, as on the web (R9). There's also a Write field and quick picks | 1/item | notes, then `POST /patients/{id}/attachments` |
| D5 Chair mode | A big-target screen. An optional "Chair 2" chip sets `in_chair` + `room_id` (R6). Dictate is hands-free. **Photo** queues each image as a visit `Photo` entry with `visit_id` and `tooth` (R15). Everything autosaves | 1 + per photo | `/queue/{id}/status`, `POST /patients/{id}/attachments` |
| D6 Chart | Tap a tooth to open the treatment form (procedure, surfaces M/O/D/B/L, material, finding, done or planned). It extends `ToothSheetStateHolder` and `ChartStateHolder` | 3–4 | `/patients/{id}/dental-chart` (R15), `/visits/{id}/procedures` |
| D7 Rx | Inline Rx with M/A/N and medicine sets; allergy swap | 2+ | prescriptions, medicine sets |
| D8 Wrap up | **Order (R2):** (1) save the note and the Rx draft, (2) one `POST /visits/{id}/finish` with the follow-up chip, the fee (prefilled from priced procedures) and the Rx to issue. **Both buttons finish with `ready_to_bill`** (re-review 2), so the server always writes `collect_payment` and no bill can be lost. **Send to desk** stops there. (3) **Collect now** then opens the A10 collect sheet on `FinishedVisit.invoice`. The payment moves the token to done (pb) and the server marks the desk's notification handled. If the doctor dismisses the sheet, the desk still has the To pay card. *This differs from the web on purpose: the web's Collect now leaves the default `done`.* A 409 `allergy_alerts` asks for the override reason and retries. **An offline finish is queued only without an Rx (R3).** With an Rx it waits for the network, because the 409 needs a person | 2–3 | `/visits/{id}/finish`, then A10 calls |
| D9 Done | Celebration with the Rx status, the follow-up date, the desk being asked for ₹X, and the share status from `FinishedVisit.share` | 0 | — |

**The 60 s target (R10)** is measured end to end on a **standard visit**: Send in, start, one dictated note, one tooth with surface and material, an Rx from a medicine set, then Wrap up and Send to desk. It's timed in T12. If it's over 60 s, the measured breakdown goes to the founder for sign-off rather than redefining the target.

## 3. Notifications and consistency (one source of truth)
- **The server shows truth.** No state is shown as done until the server confirms it. Outbox items show "Saved, will send".
- **Races (R8):**
  - collect re-GETs the balance first
  - a 409 refetches and shows the server's state
  - the To pay card closes when its notification is `handled`
  - status writes that are refused (for example, the token already left) refetch the board
  - banners are de-duplicated by notification id
  - overpayment rejection on the server is gap G12
- **Live (R14):**
  - The pb SSE stream (on main once T0 merges) is consumed by the sse client, which implements the existing `LiveUpdates` interface.
  - Any reconnect, `reset` or lost Last-Event-ID triggers a full refetch.
  - The poll stays at 20 s, or 120 s while SSE is up.
  - Coming to the foreground triggers a full refetch.
  - Push is G3.
- **Delivery today:**

  | Event | To | Delivery |
  |---|---|---|
  | `patient_waiting` | doctor | banner |
  | 60 s with no reply | desk | display-only amber state on the card |
  | `send_in` | desk | banner and sound |
  | `collect_payment` | desk | banner |
  | `task_*` | the assignee | bell and badge |
  | welcome and thank-you | the patient | server auto messages (pb) |

  The thank-you after payment depends on G9.

## 4. Tasks (Sonnet workers, at most 3 at once; each owns only its globs)
| # | Task | Owns | Depends on |
|---|---|---|---|
| T0 | **Retarget, plus the seams** (coordinator): merge feat/v9-port (main + pb) with feat/v9; regenerate models; update the dependent code (detailed below) | merge, `AppGraph.kt`, `OutboxEntry.kt`, `MainTabs.swift`, `RootView.swift`, `NavModel.kt`, the stub files, and the sse worker's `shared/.../live/*` (`SseLiveUpdates` implements `LiveUpdates`; re-review 3) | pb, sse |
| T1 | Shared home choice by permission (R13) + `ServerCaps` + tests | `shared/.../nav/Home*.kt`, `shared/.../config/ServerCaps*.kt` | T0 |
| T2 | Shared availability (R6 rules) + tests | `shared/.../desk/Availability*.kt` | T0 |
| T3 | Shared intake form holder (online-only; `PatientFile` enqueue after create) + tests | `shared/.../walkin/Intake*.kt`, `outbox/PatientFileSender.kt` | T0 |
| T4 | Shared wait timer (injected clock) + collect race rules (re-GET, 409, handled) + tests | `shared/.../desk/Wait*.kt`, and `desk/DeskPayment.kt` + `DeskPaymentDelivery.kt` (extended, not rebuilt; re-review 4) | T0 |
| T5 | Shared `FinishVisitStateHolder` (R2 order, the Rx-offline rule, allergy retry) + audio upload sender (R9) + tests | `shared/.../visit/Finish*.kt`, `outbox/AudioSender.kt` | T0 |
| T6 | Shared My tasks holder + the notification kind mapping moved into shared, de-duplicated by id + tests | `shared/.../tasks/*`, `shared/.../notifications/*` | T0 |
| T7 | iOS Desk: extend `V9Desk` (number field, strip, timer, collect re-GET, banners) | `Screens/V9Desk/*`, `DeskV10.xcstrings` | T1, T2, T4 |
| T8 | iOS intake form + PencilKit signature + photo | `Screens/IntakeV10/*`, `IntakeV10.xcstrings` | T3 |
| T9 | iOS doctor: Waiting card, intake summary, chair mode, wrap up and celebration | `Screens/DoctorV10/*`, `DoctorV10.xcstrings`; light edits in `V9Visit/*` | T5 |
| T10 | iOS My tasks and the bell | `Screens/TasksV10/*`, `TasksV10.xcstrings` | T6 |
| T11 | iOS live banners and haptics on `LiveUpdates` events | `Screens/LiveV10/*` | T0 (sse merged) |
| T12 | E2E (coordinator), detailed below | `docs/plans/v10/e2e/*` | all |
| T13 | Android, in a separate plan after iOS sign-off | `androidApp/**` | T12 |

**T0 in detail:**
1. `CloseVisit`/close → `finish`; `VisitShare` → `VisitLink`.
2. Migrate the persisted `VisitClose` outbox entries to `finish` (R3).
3. Gate `FamilyStateHolder` and the payment proof behind `ServerCaps` so they compile against main (R1).
4. **Pre-create the seams (R4):**
   - `OutboxKind.PatientFile` and `OutboxKind.Audio`
   - `AppGraph` factory stubs for each new holder
   - `Routes+V10Desk/Intake/Doctor/Tasks/Live.swift` stubs, wired into `MainTabs` / `RootView`
   - empty `DeskV10`, `IntakeV10`, `DoctorV10` and `TasksV10` `.xcstrings` tables
5. Run the gates.

**T12 in detail:**
- Use only seeded synthetic patients.
- The second actor is driven by scripted API calls, plus one manual run on two simulators.
- The clock is injected for the 60 s state.
- Time the standard visit.
- Step 11 (the thank-you) needs G9.

**Worker rules:**
- Work in the worktree `~/project/wt-v10-<task>` on branch `v10-<task>`, from the T0 merge commit. Write the handoff to `docs/plans/v10/<task>.md`.
- Edit only the globs you own. **After T0, no worker edits `AppGraph`, `OutboxEntry`, `MainTabs`, `RootView` or `NavModel`.** A missing seam goes in the handoff for the coordinator.
- Strings go in your own table, in en/hi/mr.
- Tests: commonTest and XCTest. Gates: `./gradlew check` + `ios-check.sh`.
- **Privacy (R12):**
  - Outbox photos, signatures and audio use `NSFileProtectionComplete`, and are deleted after upload.
  - Banners and logs carry token numbers and IDs, never names or clinical text.

**Order:**
1. pb and sse merge
2. T0
3. T1–T6, 3 at a time: T5, T3 and T4 first, then T1, T2 and T6
4. T7–T11
5. T12

## 5. Done means
- **The E2E passes:**
  1. lookup
  2. new patient with signature and photo (the child too, if the family flag is on)
  3. queue
  4. the doctor gets the banner
  5. the 60 s amber state (injected clock)
  6. Send in reaches the desk
  7. the visit: dictate (transcript and audio), chair photo, tooth with surface and material, Rx from a set
  8. Send to desk
  9. the desk re-GETs the invoice and collects by UPI
  10. the token goes done
  11. the thank-you in the fake log, if G9 is on main
  12. a task is done with confetti
- **Timings recorded:** returning check-in in 3 taps or fewer; the standard doctor visit end to end against 60 s, or a breakdown for the founder.
- **All gates are green.** Then push to main, post the SHA in the coordination file, and report screenshots to the founder.

## 6. Risks
- **Backend branches land at different times.** Capability flags absorb this; merge main at least every day.
- **No background push.** The desk keeps the app in the foreground until G3.
- **Legal status of the signature:** it's stored as an attachment linked to the consent (G10 later). The wording stays with the web's notice version.
- **Audio size on a slow network:** a failed upload retries the whole recording, which is safe because it's idempotent on the client v7 `id`. Recordings are capped at 600 s, within the 10 MB limit (re-review 5). The transcript is saved first, so the note never waits on the audio.
