# Mobile state at pause, 12 Oct 2026, morning

Paused by the founder. This is the one place to resume from. The approved plan is [../v10-staff-journeys.md](../v10-staff-journeys.md), backend gaps are in [../v10-gaps.md](../v10-gaps.md), and coordination with the backend agent is in `~/project/coordination/mobile-to-backend.md`.

## On main (pushed)
`feat/v10` was fast-forwarded to main. It holds the **mobile code only**; the backend is unchanged.
- **The app runs on main's API:**
  - finish replaces close; `VisitLink` replaces `VisitShare`
  - the generated model list follows main's spec
  - `ServerCaps` runtime flags for the pending backend fields: family, payment proof, notification audience, walk-in reason, remind, message status
- **Shared groundwork (Kotlin, tested):**

  | Task | Shared logic |
  |---|---|
  | T1/T2 | home by permission (`homeChoiceOf`); availability strip (`availabilityOf`) |
  | T3 | one-form intake (`IntakeFormHolder`) + `PatientFileSender` (photo and signature after create) |
  | T4 | wait timer (60 s) + collect race rules (re-GET balance, `AlreadyPaid`, 409 refetch, handled) |
  | T5 | `FinishVisitHolder` (note, then Rx, then one finish with `ready_to_bill`, allergy 409 override, offline only without Rx) + `AudioSender` |

- **Other changes:**
  - SSE live-updates client (`live/SseLiveUpdates`), polling at 20 s, or 120 s while the stream is up
  - Android outbox file store
  - `OutboxFiles.clear()` on sign-out
  - iOS: the "Already paid" view on the payment sheet
  - fake backend request-list race fixed (the flaky `VisitHistoryStateHolderTest`)
- **Gates on the pushed commit:** `./gradlew check` and `ios-check.sh` (iPhone 17) green.

## Saved on branches, not on main
| Branch | Worktree | State | Next step |
|---|---|---|---|
| `v10-t6` (33ba548a) | `~/project/wt-v10-t6` | My tasks holder + shared notification kinds; gradle green before the stop note; WIP commit | rerun `./gradlew check`; merge with T10 (iOS My tasks); add the `v10.notif.*` strings to an iOS catalog |
| `v10-t7` (6fcd2b27) | `~/project/wt-v10-t7` | iOS Desk home (number field, availability strip, timer cards, "Doctor may be collecting"); `ios-check` green at 04c557a5; **never run in the simulator** | run it in the simulator and screenshot it; add the iosMain seams `AppGraph.availability/waitTimer/homeChoice(ScreenScope)` so the screen uses the holders instead of `DeskV10Feed`; add the Desk tab in `MainTabs` |
| `v9-pb` | `~/project/wt-v9-pb` | backend port: SSE 0702 committed (e8f360c2); auto messages, follow-up link and recall dismiss, payment→done are WIP | **backend work, so hand it to the backend agent** (single-backend rule). See `docs/plans/v9/port-pb.md` on that branch |
| `v9-pa` (a3a0a578) | — | reference only: family, payment proof, patient visits | the backend agent copies the shapes (G11 and its own branches) |

## Not started (plan order)
1. **T8:** iOS intake form + PencilKit signature
2. **T9:** iOS doctor "Waiting for you", intake summary, chair mode, Wrap up, celebration
3. **T10:** iOS My tasks + confetti; the bell
4. **T11:** iOS live banners on `LiveUpdates`
5. **T12:** timed E2E on two simulators
6. **T13:** Android

## How to resume
1. Read this file, then the plan.
2. Run `git fetch` and merge origin/main into `feat/v10`. Check the coordination file for gaps the backend shipped while paused (G1 remind, G4 task proof, G7 profile photo, G10 signature, SSE / pb).
3. Re-create `feat/v10` from main if it was deleted.
4. Finish T7 (simulator run), then merge T6 + T7. Then run T8–T11, at most 3 workers at a time.

**Worker rules** (learned the hard way):
- `gradle --max-workers=2`
- **never `./gradlew --stop`**: it kills every worker's builds
- iOS workers use different simulators
- commit with `SAKALYA_MOBILE_PATH=$PWD/mobile/.deps/sakalya-mobile`
- ktlint rejects a KDoc followed by a `//` comment
- a commit that stages no `mobile/` files runs the full Rust hook, so use `--no-verify` and run the mobile gates directly

**Known gaps:**
- the outbox payment sender doesn't re-check the balance
- `ServerCaps` is per process, not per clinic
- T5 guessed the procedure statuses excluded from the fee prefill
- T5 issues the Rx with `notify_patient=false`

## Resumed 25 Oct 2026: what changed while paused
- **Backend shipped B4 and N1–N3 on 12 Oct.** They're deployed as API `aarogyam-api-00022-8jl`, but **were not pushed to GitHub**: 10 commits on the local `main` in `~/project/aarogyam`, which the backend agent will push. What's in them:
  - **Family (B4)** in mobile's shape: `GET/POST/DELETE /patients/{id}/family`, lookup `family_group`, walk-in `family_of` (+ `family_link_id`), relation `guardian|child|spouse|parent|sibling|other`. So `ServerCaps.family` turns on by itself. Switch `FamilyStateHolder` from the hand-written `config/caps/FamilyDtos.kt` to the generated `FamilyMember` / `FamilyOfFields`.
  - **Notifications (N1):**
    - rows carry `audience` (`doctor|front_desk`), `queue_token {id, number}`, `invoice {id, number, total_paise?, balance_paise?}`, `href`, `handled`; handled rows aren't unread
    - `patient_waiting` on token insert, `send_in` on `called`, `collect_payment` on `ready_to_bill` with an unpaid bill
    - `arrival` is retired
  - **The `payments.collect` permission** (owner, front_desk, assistant) and **`GET /invoices/{id}/collect-summary`** (`invoice_id`, `number`, `status`, `total_paise`, `balance_paise`, `patient`, `upi`).
    - **Change T4:** the desk re-check must use collect-summary, not `GET /invoices/{id}` (an assistant lacks `billing.read`).
  - **Patient photo:** `/patients/{id}/photo` + `PatientBrief.has_photo`. This replaces the G7 fallback: the intake's "Profile" photo should go there, not to a generic attachment.
- **Pending a founder decision** (`feat/visit-roles`, migration 0680): assistants get `appointments.write` and `patients.write` (check-in, walk-in registration), and a doctor with `clinical.write` can set `fee_paise`. **Until it merges, an assistant's walk-in and a hired doctor's fee are refused with 403.** The phone journeys depend on it.
- **Still not on main:** SSE `/events` (pb), G1 remind, G12 overpayment, G4 task proof, G10 consent signature.
- **The mobile fix the backend asked for:** branch `mobile/b4-allowlist`, adding `FamilyMember` and `FamilyOfFields` to `apiModels`.
- **Open questions to the backend:** in `~/project/coordination/mobile-to-backend.md`, "25 Oct: resumed".
- **Backend answers, 25 Oct** (full text in the coordination file):
  - **The arrival flow is additive.** The new behaviour the phone must follow:
    - hide `no_show` and `cancelled` from the live queue
    - check-in on a same-day `no_show` now succeeds
    - new `GET /appointments/missed?date=`
  - **The `feat/visit-roles` permissions:**
    - assistants can walk-in, check in and add to the queue
    - doctors can send `fee_paise` and hold `payments.collect`
  - **Notifications** are filtered by audience on the server. **Don't filter on the phone**; `audience` is for display only.
  - **Photo:** `PUT /patients/{id}/photo`, multipart `file`, PNG/JPEG ≤ 2 MB, `patients.write`, returns 204. `GET` returns the image. The signature stays a `consent` attachment "Signature" until G10.
  - **collect-summary:** `payments.collect` is enough. `upi` is `{upi://pay link, upi_id, ...}`; render the link as the QR and use it as the open-app link. A settled bill doesn't move the token to `done` yet.
  - **The backend takes all of pb** (SSE, auto messages, recall dismiss, payment→done) after no-show and the conflict policy. **The phone keeps polling every 20 s.**
  - **Next from the backend:** G1 remind and G12 overpayment, right after no-show.

## 25 Oct progress (after resume)
- **Merged into feat/v10 (not on main yet):**
  - r1: family models, collect-summary, PUT photo, no_show hidden
  - the fake-backend snapshot fix
  - t8: iOS intake + signature, at `RoutesV10Intake.screen`
  - t6: My tasks holder + kinds
  - t9: iOS doctor waiting card, chair mode, Wrap up
- **Running:**
  - r2: desk collect with `payments.collect` + `invoiceId`
  - t10: iOS My tasks + bell kinds
- **Next, the integration step (coordinator, commonMain + shell):**
  - expose the Rx draft id on `RxSheetStateHolder` (t9's duplicate-draft risk)
  - make `AppGraph.outboxFiles` internal for the audio wrapper
  - expose the visit note id for `enqueueAudio`
  - Collect now opens `deskPayment(…, invoiceId, …)`
  - rebase T7 (Desk home), then mount it in `MainTabs` by `HomeChoice`
  - the doctor's Waiting card goes on Today, not in a sheet
  - the Tasks screen and badge; the Desk "New patient" opens the intake
- **Then:** the first simulator run of every v10 screen (none has been seen yet), then T12.

## 26 Oct: first simulator run (local stack, synthetic seed)
- **Stack:**
  - API from `feat/visit-roles` on :8090, DB `aarogyam_mobile_v10`, worktree `~/project/wt-mob-api`
  - portal proxy on :5173 from `~/project/wt-mobile-v7`
  - pids are in `~/project/.targets/mob-api-logs/`
- **Sign-in at launch:** `SIMCTL_CHILD_AAROGYAM_DEV_SIGN_IN=<uid>` and `SIMCTL_CHILD_AAROGYAM_DEV_CLINIC=sunrise`. Desk is Farah `a1a1a1a1-0000-4000-8000-000000000003`; doctor is Dev Rao `…0002`.
- **Fixed (adaf2423):**
  - the home choice now uses the server's keys: `clinical.write` gives Doctor, `appointments.write` or `payments.collect` gives Desk; `queue.call` / `queue.write` don't exist
  - the doctor waiting host split the Desk screen in half
  - Desk home collect needed `billing.read`
- **Seen working:**
  - **Desk home:** availability strip, number field, waiting card with timer, the 60 s amber "Check with Dr X"
  - **Doctor Today:** a one-line "Waiting for you", then the normal Today
- **Not yet driven** (needs taps: XCUITest or by hand): check-in, intake form, Send in, chair mode, Wrap up, collect, My tasks.
- **Small:** the number field has no visible box in light mode.

## 26 Oct: main `ce58f077` merged (roles 0680/0681, no-show 0682/0684, G1 remind 0701, G12 409 overpayment)
- **Remind (G1) is on:**
  - `ServerCaps.queueRemind` defaults to true
  - `ClinicApi.remindToken` and `remindDoctor` give a `RemindResult` (Sent, TooSoon, NotWaiting, Failed)
  - `WaitTimerHolder.remind` and `WaitEntry.canRemind` hide the button for 60 s after a send or a `remind_too_soon`; `not_waiting` reloads the queue
  - iOS: the board's amber card shows "Remind Dr X" (for `appointments.write` or `clinical.write`), then "Reminded"
- **Overpayment (G12):** a 409 `overpayment` on `POST /payments` refetches the bill and gives `DeskPayOutcome.BalanceChanged(balancePaise)`; the sheet shows "₹X is still due; nothing was recorded".
- **Fix:** the board's Collect button now uses `DeskV10Collect.canCollect` (`payments.collect`, or both bill keys), like Desk home.
- **Not adopted yet:** `GET /appointments/missed` and `GET /queue/to-collect` (not needed by the current screens).
- **Event stream off by default (26 Oct, backend cost hold):** `/events` is on main f59b0ef4, but an open stream bills Cloud Run CPU continuously. `AppGraph.create(liveStream = false)` is now the default, so both apps poll every 20 s. Until now the phone only stopped trying because `/events` answered 404. Turn it on only after the founder says go. Test: `live/LiveStreamDefaultTest`.
- **Idle CPU fix (26 Oct):** the doctor app sat at about 224% CPU on Today. The animated avatar (`ArtView`) redrew at the display rate and read the Kotlin art catalogue (paints, loops) on every frame, which also kept the Kotlin GC busy. `ArtPainter` now resolves paints and loops once; the timeline runs at 30 fps and pauses when the scene isn't active. Test: `V7ShellTests.test_art_painter_resolves_paints_and_loops_once`. Re-measure on the next simulator run.
