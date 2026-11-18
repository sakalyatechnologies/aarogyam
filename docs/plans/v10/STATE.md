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

## Plan order
T8–T12 (iOS intake and signature, doctor screens, My tasks and the bell, live banners, the timed two-simulator E2E) are done; see the dated sections below. Not started: **T13** Android, after iOS sign-off.

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
- **Idle CPU fix (26 Oct):** the doctor app sat at about 224% CPU on Today. The animated avatar (`ArtView`) redrew at the display rate and read the Kotlin art catalogue (paints, loops) on every frame, which also kept the Kotlin GC busy. `ArtPainter` now resolves paints and loops once; the timeline runs at 30 fps and pauses when the scene isn't active. Test: `V7ShellTests.test_art_painter_resolves_paints_and_loops_once`. Measured after: 7–17% CPU idle on Today (iPhone Air, was 224%).
- **Main `34946ef3` (B6: reports, stock, payment proof, part UPI amount) merged (cf17a0cb);** no mobile changes. Gates green (gradle, iOS 174/174).
- **Desk home:** the number field has an outline (1 pt, 2 pt primary when focused), since the card matches the page in light mode. Closing the payment sheet reloads the board and feed at once, because a settling payment now moves the token to done on the server.

## 29 Oct: foreground-only polling (founder decision) and the doctor's Start visit
- **Founder decision (relayed by the backend, 29 Oct):** live events stay off until launch; screens poll only while the app is open and in front.
  - Shared `AppForeground` + `pollWhileInFront` (commonMain). `PollingUpdates`, `DoctorWaitingHolder` and the `WaitTimerHolder` tick wait while it's false and reload at once on return. Test: `live/ForegroundPollTest`.
  - iOS: `RootView` sets it from `scenePhase` (`.active` only); the Swift loops (desk feed, board, chat) use `.task(id: scenePhase)`.
  - Android: `MainActivity.onStart/onStop`; the Today badge poll uses `pollWhileInFront`.
  - The patient app has no polls.
  - `AppForeground` has no clinic concept, so it moves to sakalya-mobile with the next kit release (rule 13).
- **D3 Start visit was missing:** after Send in, the patient left the doctor's card and Today had no way into the visit. The card now keeps `called` rows with **Start visit**, which pushes `VisitRoute.fromQueue` (start-visit seats the token). Strings `dv10.start`, `dv10.start.a11y`, `dv10.called` (en/hi/mr).

## 29 Oct: T12, first passing two-phone run
- **How:** `mobile/iosApp/scripts/e2e-visit.sh` (target `AarogyamStaffE2E`, its own scheme, not in the gate). It builds the Local app once, runs desk (iPhone Air), doctor (iPhone 17), desk, then shuts both simulators down. It needs the local API (:8090, from main) and the portal proxy (:5173).
- **Run 4 passed end to end;** the database shows the token went to done.

  | Phase | Step | Seconds | Taps |
  |---|---|---|---|
  | Desk | lookup (type number, New patient) | 10.3 | 2 |
  | Desk | intake (name, age, sex, allergies, notice, signature, doctor, save) | 40.5 | 9 |
  | Doctor | waiting → Send in | 6.5 | 1 |
  | Doctor | Start visit → visit screen | 4.0 | 1 |
  | Doctor | Wrap up, fee ₹500, Send to desk | 13.2 | 3 |
  | Desk | Collect (find card, cash, record) | 21.8 | 3 |

  These are machine timings (typing is instant; the collect step includes waiting for the board's poll). The 60 s doctor target still needs the standard visit: one dictated note, one tooth, and an Rx from a set, which aren't in the run yet.
- **Bugs the run found, fixed:**
  - The front desk couldn't pay a visit's draft bill (409); fixed in the commit before this one.
  - **The intake form showed raw keys:** `IntakeV10.xcstrings` was never committed by T8. 36 strings added in en/hi/mr, and `StringCatalogTests` now fails on an empty table or a language that differs.
  - The signature pad's label never reached the accessibility tree. It's named on the SwiftUI side, with direct interaction for VoiceOver.
- **Not covered yet:** dictation and audio (simulator microphone), chair photo, tooth chart, Rx from a set, My tasks confetti, the 60 s amber state, and Remind. The backend's G9 thank-you message isn't on main.
- **Left in the local DB:** token 2 from run 2 is still `ready_to_bill` (synthetic).

## 1 Nov: T11 live banners, Desk home earlier-day lists, longer T12, on main `9f35034f`
- **Shared (adopt):** `missedAppointments(date?)`, `toCollect()`, `dismissRecall(id, reason?)`; `desk/ToCollectHolder`, `desk/MissedHolder`, `RecallsStateHolder.dismiss`. Remind's `retry_after_seconds` is **not** adopted: the kit `ApiError` has no field for it (kit change).
- **T11 live banners:** `live/LiveBannerHolder` polls unread staff notifications in front (the first load only primes) and raises `patient_waiting`, `send_in` and `collect_payment`. iOS `LiveBannerView` over every tab: 6 s, haptic, a sound for send in, VoiceOver, Reduce Motion fade, taps pass through when empty. The doctor card's inline banner moved here (`dv10.waiting.banner` is now unused). Sound and haptic are untested on a device.
- **Desk home:** "Unpaid from earlier days" (Collect opens the payment sheet on that bill) and "Missed today" (tap opens the patient), collapsible, closed past three rows.
- **T12 now covers** chair mode, one tooth (16, via Other…) and one Rx (Paracetamol by search). Run on the merged branch, machine quiet:

  | Phase | Step | Seconds | Taps |
  |---|---|---|---|
  | Desk | lookup | 9.6 | 2 |
  | Desk | intake | 36.6 | 9 |
  | Doctor | waiting → Send in | 5.8 | 1 |
  | Doctor | Start visit | 3.7 | 1 |
  | Doctor | chair open/close | 5.5 | 2 |
  | Doctor | tooth | 11.7 | 3 |
  | Doctor | Rx | 11.9 | 3 |
  | Doctor | wrap-up, ₹500, Send to desk | 24.7 | 3 |
  | Desk | collect | 15.8 | 3 |

  **Doctor total 63 s / 13 taps against the 60 s target.** Wrap-up is the slow step (Issue Rx sheet, fee field).
- **Gaps found:** the visit's treatment form has no surface or material (only the Chart tab does); the visit Rx card has no medicine sets (`/api/v1/medicine-sets` exists); photo and dictation can't run on the simulator.
- **Flaky:** `SseLiveUpdatesTest.no_heartbeat_means_dead…` runs on real time (150 ms heartbeats) and failed once under load.
- **Next:** medicine sets in the visit Rx card; surface and material in the visit tooth form; G4 task proof photo; G10 consent `signature_attachment_id`; a recall-dismiss UI (where the follow-up list lives is a design call); Android T13 after iOS sign-off.

## 1 Nov evening: medicine sets, task proof photo, banner fix, on main `e9dac100`
- **Medicine sets** in the visit Rx card: chips from `QuickPicks.medicine_sets` (specialty and clinic sets); a tap adds every medicine as a free-text line (`drugId` null), skipping names already on the Rx. A set's `instructions` are dropped (no `RxLine` field). `RxSheetStateHolder.kt` is about 400 lines and needs a split.
- **G4 task proof photo:** a camera button on open My tasks rows (photo library on a device without a camera); upload once, then complete with `proof_file_id`; a retry reuses the upload. The camera path is untested on the simulator.
- **Live banner stuck:** a send-in banner stayed on the doctor's visit screen. The 6 s hide now lives in `LiveBannerHolder` (`showMillis`, tested); the view only mirrors it. Verified in T12: no banner at the visit screenshot.
- **send_in audience (backend, decisions 2026-10-11):** the doctor is the audience. The bug was being told of their own Send in; backend 0709 writes that row already handled, and the phone already skips handled rows.
- **T12 now adds the Rx with one set tap:** rx 4–5 s / 2 taps (was 11.9 s / 3). Doctor total about 62 s / 12 taps, but all three runs were under load 150–225 from backend builds; wrap-up (30 s) needs a quiet re-time.
- **Waiting on backend:** G10 intake link (`WalkIn.consents[]` + `PUT /patients/{id}/consents/{consent_id}/signature`) and 0709, in one SHA.

## 14 Nov: G10, G8, tooth surfaces, family intake, on main after `5a52a868`
- **Local stack:** the API on :8090 is rebuilt from main `5a52a868` (DB `aarogyam_mobile_v10`, migrations 0600–0710 applied). Prod is `aarogyam-api-00029-6hz` at the same SHA.
- **G10 intake signature, verified end to end:** the outbox sends the signature upload, then `PUT /patients/{id}/consents/{consent_id}/signature` for each `WalkIn.consents` id. A network loss retries the item with the same upload id; a 409 is final and logged by code. T12 found the desk got 403 on the upload (it lacks `clinical.write`); the backend's b436f7e6 now allows kind `consent` for `patients.write`. After a T12 intake, both consents (care, reminders) have `signature_attachment_id`.
- **G8 welcome status:** a desk board card shows one line when `welcome_status` is failed or skipped (no consent, opted out, no phone or email, other). Queued and sent show nothing. `thanks_status` isn't shown: a paid token leaves the board, and the backend agrees it belongs on web history if anywhere.
- **Visit treatment lines:** optional M/O/D/B/L toggles, lettered and named for the tooth (incisal, palatal), and a Material menu. Tooth then treatment is still two taps. Surfaces go to `NewProcedure.surfaces`; surfaces and material go to the chart finding.
- **Rx:** `RxSheetStateHolder` split. Draft, issue and share are in `RxIssuer` (295 + 151 lines). A medicine set's `instructions` now reach `RxItem.instructions` and show under the medicine.
- **Family on the v10 intake:** when the number already has patients, "Family of" lists them with "Not family" picked at first; picking one shows the relation chips and sends `family_of`. The desk home profile row opens Relatives. T12 phase 4 (same number, nothing saved) screenshots it.
- **Kit bug (not fixed in the kit):** `SkFlowLayout` reports its widest row as its width; placed at exactly that width, pixel rounding wraps the row's last chip onto a row it never counted, over the next view. The family chips use the app's `FlowLayout` instead, which now wraps only past half a point of slack. The kit fix needs a kit release.
- **B7 allowlist:** `ChatAttachment` and `LabTrackerStage` are in `apiModels` ahead of the backend's labs and chat merge (the generator ignores names the spec doesn't have yet).
- **Wrap up lost the visit's treatments (fixed):** the staged treatments were only sent by Close visit, so the v10 path (Wrap up, then Send to desk or Collect) finished without them. No T12 visit before 14 Nov saved its filling. Wrap up now saves them first and stops with "procedures failed" if one fails. Checked on the server after T12: Filling on 16, done.
- **Follow-ups on the patient Overview:** open recalls for the patient (due date, reason), with Dismiss after a confirm for `patients.write`. Local debug: `AAROGYAM_DEV_PATIENT=<id>` opens a patient page, `AAROGYAM_DEV_SCROLL=followups` scrolls to the card.
- **Logs:** `tasks.proof_failed`, `tasks.complete_failed` (occurrence id and code). `dv10.waiting.banner` removed.
- **T12, quiet machine (load under 20):** doctor 53 s / 12 taps (Send in 4.8, start 3.2, chair 5.0, tooth 10.1, Rx 3.6, wrap-up 26.2).
- **Still open:** Remind `retry_after_seconds` (kit `ApiError` change); camera, dictation, sound and haptics untested on a device; Android T13 after iOS sign-off.

## 14–15 Nov: store release and the work queue (resume here after a limit reset)
The founder's decisions:
- One role-based app for everyone. Patients join the same app later; the patient app is not shipped.
- Released from Sakalya's existing Apple and Google accounts.
- fastlane is the priority (`mobile/docs/release.md`).

Done:
- fastlane lanes, Android upload signing (key in `~/.aarogyam-release/`), the iOS icon and privacy manifest, the listing text (`7e43e01d`).
- B7 labs (`v11-labs`) and chat (`v11-chat`), merged on `feat/v10`.
- G11 patient visit history (`v11-pvisits`).
- Remind cooldown; kit `v0.2.0-dev.3` (SkFlowLayout).

**Queue, in order:**
1. Visual check of labs and chat (`AarogyamStaffE2E/StoreScreensTests.swift`, local API on 8090 with synthetic LAB-1/LAB-2 and an Everyone notice). Merge `v11-pvisits`. Push.
2. Chat thumbnails: when a download link has expired, ask for a new one instead of leaving a blank tile.
3. `v11-store` (worker): "Use a password" sign-in (kit `SupabaseAuthClient.signInWithPassword` in `wt-sakalya-kit`) and Delete account (`DELETE /me/account`). Then tag the kit `v0.2.0-dev.4`, push the tag, repin, merge.
4. Store screenshots: extend StoreScreensTests (Today, desk board, doctor waiting, patient tooth chart, visit with Rx, labs, chat) on the largest iPhone, exported to `fastlane/screenshots/ios/en-US`.
5. Push on iOS, once the backend ships migration 0713 and `PUT/DELETE /me/devices/{installation_id}`:
   - register for APNs and send the token;
   - `push.<kind>` loc-keys for the 19 kinds plus `push.generic` and `push.title`, in en/hi/mr;
   - on tap, switch to `org_id`, open `href` and mark `id` read.
6. Connect Delete account to the live endpoint and check the `last_owner` 409 body.
7. Android T13 parity (v9/v10 desk, doctor, visit, intake, tasks, banners, labs, chat, password, deletion, FCM push), then Play screenshots and the first internal upload.

**Waiting on the founder:**
- the App Store Connect API key and the Play service-account JSON (in `mobile/fastlane/credentials/`);
- the store name, icon, support email and WhatsApp, and the review phone number;
- the stable domain before production;
- a backup of `~/.aarogyam-release/`;
- approval of the privacy text.

### 15 Nov, progress (update)
- **Pushed:** main f8b826c7 (full gate passed): fastlane, labs, chat, patient visits, the thumbnail fix and the Android route stubs.
- **On `feat/v10`, not pushed** (it needs one full gate, run as `sh scratchpad gate.sh`: gradle check, ios-check and the patient check, through `~/project/.targets/build-lock.sh`):
  - store screens test;
  - `v11-push` merged (the iOS push client);
  - fc9f5944: push registers again on each new sign-in, and sign-out revokes the session.
- **Workers and branches** (each has a handoff in `docs/plans/v10/android-<area>.md` or a commit message):

  | Branch | Work |
  |---|---|
  | `v11-and-{desk,visit,patient,clinical,shell}` | Android T13 |
  | `v11-store` + kit `wt-sakalya-kit` | password sign-in and Delete account (a 404 `no_staff_account` state). After merge: tag kit `v0.2.0-dev.4`, push the tag, repin. |
  | `v11-shots` | store demo seed (`iosApp/scripts/store-seed.sh`), App Store screenshots into `fastlane/screenshots/ios/en-US`, the waiting card clipping and the "patients for you" count |
  | `v11-analytics` | custom dates, revenue vs expenses, expense categories, per-chair use, Preview cards filled from the live API, and a Close button on My tasks |

- **Backend:**
  - Account deletion: `DELETE /me/account` (0713).
  - Push: `PUT/DELETE /me/devices` and `POST /me/sessions/revoke-current` (0714); off until the keys exist.
  - The pages /support, /account-deletion and /privacy.
- **Open question to the founder:** the "ROCM … icon on the top right" request; is it a profile or role icon?
- **The founder is viewing the app** on simulator "iPhone 18 Pro" (no worker uses it).

### 15 Nov, evening: main e328a8e9 (full gate passed)
- **Done and pushed:**
  - Android T13 complete: desk, visit, patient, labs, chat, team, expenses, analytics, shell, Schedule, sign-in v7 with invites, password, Delete account. Checked on the Pixel_9a emulator against the local API (`adb reverse tcp:5173 tcp:5173`).
  - iOS: analytics v11, push client, password, Delete account, the My tasks Close button, App Store screenshots (`mobile/fastlane/screenshots/ios/en-US`) with the demo seed `mobile/iosApp/scripts/store-seed.sh`.
- **Next:**
  1. When the backend's 0713/0714 are on prod: test push (needs the APNs key), password sign-in (review account) and Delete account (a throwaway account only).
  2. Android push (FCM): it needs the founder's Firebase project and `google-services.json`.
  3. Play screenshots from the emulator.
  4. The first TestFlight and Play internal uploads once the founder adds the keys (`mobile/docs/release.md`).
  5. Optional: retake iOS shot 2 (visit with Rx) cleaner.
- **The founder's open question:** the "ROCM … icon on the top right".

### 18 Nov, late night: tooth health
- **Tooth health (both apps):** a Health card on the tooth sheet (Healthy, Watch or Needs treatment; one tap saves via PUT .../teeth/{tooth}/status, rolled back if refused). Without a status the chart's suggestion shows, labelled. Watch and Needs treatment take a "treat within" of 1, 3, 6 or 12 months and a one-line note; "Use the chart's suggestion" sends the DELETE.
- **Done elsewhere:** offered in Add treatment for finished work (filled, crown, root canal, implant, bridge, missing). It marks the chart with `elsewhere` and logs no visit procedure; history says "Done elsewhere".
- **Jaw Health view:** a Findings / Health switch on the patient's jaw (healthy green, watch yellow, needs treatment red, not assessed plain).
- Checked end to end on the Android emulator against the local API on main a1a8853e: set 200, months 200, reset 204, done-elsewhere crown 200.

### 18 Nov, night: session expiry, phone registration, BK-5
- **Session expiry (backend 0723):** the API ends sessions itself (browser 12 idle hours or 7 days; a session with a registered device 30 idle days) without ending the Supabase session, so the token refresh succeeds and the API keeps refusing. `api/SessionEndWatch.kt` counts 401s per request; a second one after the refresh signs out locally (Supabase `scope=local`) and the app returns to sign-in.
- **Phone registration (0725):** every sign-in sends `PUT /me/devices/{installation id}` with the real platform, app `staff` and locale, and no token until there is one (once per session); the token follows when it arrives. Android sends the app's language at start. Without this, Android (no FCM yet) and iPhones that declined notifications counted as browsers.
- **BK-5 (both apps):** the expense method is saved; Bill photo takes a resized JPEG that uploads after the save (`POST /expenses/{id}/bill`), with Send photo again or Skip when only that fails; rows show the method and open the bill through a five-minute link. With `expenses.write`, tapping a row with a bill offers Open bill or Remove bill photo. Checked end to end on the Android emulator against the local API (save 201, upload 200, open in Chrome, remove 200). The Android sheet's Bill photo and Save now sit in a fixed footer (they were cut off on 1080×1920).
- **Push locale:** the server only takes `xx-YY`; the app sent `hi`, so no phone had ever registered (400 since 0714). It now sends `en-IN`, `hi-IN` or `mr-IN`. Dev installs need a rebuild to get it.
- **Analytics:** Week is the last 7 days as daily bars (API `bucket=day`), ranges up to 31 days are daily, up to 120 weekly, beyond monthly. The parity deviation is gone.
- **apiModels:** `ExpenseBill` added (BK-5 had broken the generation on main). The backend adds `ToothStatus` and `ToothHealth` with its tooth-health commit.
- **Invite resend/cancel:** checked on the Android emulator against the local API (menu, confirm, both toasts, the row goes).

### 18 Nov, later: invite resend and cancel
- **Team (both apps):** each pending invitation has a "⋮" menu with Resend invitation (`POST /staff/invitations/{id}/resend`, a fresh 7-day link; the token is dropped) and Cancel invitation (`DELETE`, after a confirm). Toasts: "Invitation sent again to {email}" and "Invitation cancelled"; errors show as a toast too. Only an owner sees the menu on an owner's invitation (the API answers 403). A 404 reloads the list. Shared `TeamStateHolder.resend`, `cancel`, `busy` and `notice`; tests in `TeamInvitesTest`.

### 18 Nov: main 91a7daeb
- **Play screenshots: done (5).** In `mobile/fastlane/metadata/android/en-US/images/phoneScreenshots`: 1 Today with "Waiting for you", 2 Patient, 3 History, 4 Schedule queue with the chair board, 5 Visit with tagged notes. All 1080×1920 from the store seed (`iosApp/scripts/store-seed.sh`). Analytics was left out: the synthetic money looks wrong (negative net, 0% chair use).
- **Fixed while shooting (Android):**
  - Chair mode (a dialog window) sat under the clock with white icons; it now pads for the bars and sets its own icons.
  - The Schedule segments overlapped the clock.
  - Today and More get a page-coloured scrim under the status bar.
  - Write focuses the note field.
- **No-shows (BK-17):** real, from `/today` `counts.no_shows`, read alongside `/queue`.
- **Invite name and phone (0720):** optional on both apps; pending invites show the name.
- **Emulator recipe:** boot with `scratchpad/emu-boot.sh` (`-crash-report-mode never`, no `-memory`). After boot, tap Wait on the first "System UI isn't responding" dialog, then give it 30 s. uiautomator dumps hang, so navigate by screencap and coordinates. Taps right after a launch are lost; wait about 12 s.
- **Local data:** two blank 16 Nov walk-in visits for Meera Joshi (SD-29) were closed through the API; they still show as "Walk-in visit" in her history.

### 17 Nov: main 57007ce3 and before
- **Polish (both apps):** jaw teeth are spaced evenly along the arch for the real box size, so 17/18 and 37/38 no longer overlap. The folded "Waiting for you" line shows the count and a chevron. Android Visit has a status bar scrim.
- **Correct note (both apps):** on a past visit, "Correct note" (clinical.write) edits the four parts and signs a correction (`POST /notes/{id}/amend`). "Corrected" and "Earlier version" read `GET /notes/{id}/versions`. The rule mirrors the server: signed notes, or my own draft once the visit is closed.
- **Dictation:** words still being recognised when listening stops or fails become a bullet instead of being dropped (the Android error path used to lose them; iOS already kept them). This matches the web fix in 3f50a98e.
- **Team invite (both apps):** Invite on Team (staff.manage), with an email and a role from GET /roles; non-owners don't see owner. POST /staff/invitations; the invite token is dropped. Pending invitations are listed under the members. Next: send `display_name` and `phone` once 0720's NewInvitation is in the spec on main.
- **Android status bar:** icons were dark on every dark brand header (`SystemBarStyle.auto` in light mode). `ui/StatusBarTone.kt` counts dark headers on screen (each SkTopBar and the visit header) and sets light icons while any is shown. **The 3 Play shots taken before this fix (Patient and History especially) need retaking.**
- **Play screenshots:** still to do (and retakes of the 3, above). Emulator lessons:
  - A stale crash report in `/tmp/android-<user>/emu-crash-*.db` blocks boot on "Showing crashdialog to get consent". `emu-boot.sh` now passes `-crash-report-mode never`.
  - `-memory 2048` starves the system on this image (System UI and launcher "not responding"); boot without it.
  - Other sessions' node jobs still starve adb at times, so take shots when the load is under about 20.
- **Backend support now used (previews gone):** a real chair board (BK-14: `room_id` on in_chair; shared `chairBoard`, Seat next per chair), chart correction onto another surface (BK-1: `supersedes_id` on the first new entry), and an Idempotency-Key on expense saves (BK-6). Still a preview: expense bill photo (BK-5), the queue no-shows chip (BK-17), the Today month target and sterilisation extras (BK-15/16). Call in on the Today hero isn't wired (the hero is an appointment; doctors use Send in on "Waiting for you").
- **Gate script:** gradle runs with `--no-watch-fs`, after the file watcher missed new strings and left the resources "up to date".

### 16 Nov, early: main 1a2f6305
- **Booking overlap:** both booking sheets (iOS and Android, Schedule and Patient) show "This patient is also booked 10:00–10:30 with Dr. Rao, Chair 2" from `patient_overlaps` (backend e641c5fa). Strings in en/hi/mr. The app never moves appointments, so the /move overlaps don't apply.
- **Note corrections (0719):** nothing to change. The app never edits a note after End visit (edits stop once the visit is closed or the note is signed, and the outbox sends a queued close only after that visit's note writes), so the new PATCH 409 is safe. The note lists now return the current version only. An "Amend note" action in visit history is possible later via `POST /notes/{id}/amend`.

### 15 Nov, night: main 0f243a97
- **Prod:** 0713–0717 are live (API rev 00034). Signed out, the new routes answer 401 on lotus: DELETE /me/account, PUT/DELETE /me/devices/{id}, POST /me/sessions/revoke-current. Signed-in tests wait for the founder's review account at lotus (`review-account`).
- **Fixed and pushed:**
  - Start treatment from the patient page always opened a new visit, so a second tap left two open visits and the queue token waiting. It now resumes my open visit with that patient, its draft note's bullets restored; otherwise it starts from the patient's waiting or called token; otherwise it opens a new visit. Shared code, so both apps.
  - Android: a hardware Return in the visit note field adds the point.
  - `LabPaymentProof` was added to apiModels; backend 0716 had broken the mobile build. The backend now adds nested schemas itself.
  - The push test waits got 20 s of real time.
- **Play screenshots:** 3 of them (Today, Patient, History, 1080×1920) in `mobile/fastlane/metadata/android/en-US/images/phoneScreenshots`, which meets Play's minimum of 2. Still to do: Visit, Desk, Analytics and Labs. The emulator stalls under load above 60. Keep the local Patients list out of shots: it holds E2E junk and a real person's name.
- **Seen, not fixed yet:**
  - Jaw chart: teeth 17/18 and 37/38 overlap at 1080 px wide.
  - The collapsed "Waiting for you" line has no count or chevron.
  - Scrolled content shows under the status bar on Visit.
