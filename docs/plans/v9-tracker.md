# v9 tracker: the clinic visit flow, end to end

Plan: rev 10 of the mobile v7 plan. Flow: `docs/flows/clinic-visit-flow.md`. Only the coordinating session edits this file. Each worker writes its own handoff file, `docs/plans/v9/<name>.md`.

## Branches

| Branch | Base | Use |
|---|---|---|
| `feat/v9` | 0769804 | Mobile integration; the shared and iOS branches merge here |
| `feat/v9-backend` | main 60047b9 | Backend integration; the be-* branches merge here |

## Ownership notes

- **Web (`web/`)** belongs to the dashboard agent's `feat/v2-*` branches. v9 workers never touch it.
- **Migrations:** main stops at 0397. v9 workers use 0420 to 0429.

## Tasks

| Wave | Worker | Task | Migration | Status |
|---|---|---|---|---|
| 1 | rxdose | Rx dosing model | — | paused · staged, not committed (8 tests pass; the pre-commit check was killed for low memory) |
| 1 | history | Visit history and detail holders | — | paused · wip e2670cb (holders and tests pass in jvmTest; run gradle check) |
| 1 | overview | Patient overview holder and money summary | — | paused · staged, not committed (8 tests pass; pre-commit check needs SAKALYA_MOBILE_PATH) |
| 1 | consent | Consents holder and client | — | paused · staged, not committed (7 tests pass; open: does the server honour Idempotency-Key?) |
| 1 | outbox | Offline outbox | — | paused · staged, not committed (8 tests pass; the pre-commit check was killed for low memory) |
| 1 | desk | PatientState mapper and desk lookup | — | paused · staged, not committed (11 tests pass; commit when the machine is idle) |
| 1 | be-queue | BE2 queue states and call; BE4 staff notifications | 0420, 0421 | paused · wip 7250cf2 (written but not compiled or tested; next: compile, sqlx-prepare, OpenAPI, tests, feed) |
| 1 | be-close | BE5 close with follow-up and fee; BE6 payment proof | 0422, 0423 | paused · staged, not committed, never compiled (next: migrate the DB, sqlx-prepare, fix the build) |
| 1 | be-family | BE1 patient relations | 0424 | paused · wip 4421bad (domain, dal, app unverified; API and tests to do) |
| 1 | be-share | BE8 visit share page and patient visits | 0425 | paused · wip b888bde (dal not compiling; API, tests to do) |
| 2 | be-events | BE3 SSE events | — | waits for be-queue |
| 2 | be-msg | BE7 WhatsApp/SMS adapter and templates | 0426 | waits for be-share |
| 2 | sh-wire | Mobile models and client calls for BE1–BE8; polling | — | waits for wave 1 |
| 3 | ios-patient | Patient page with 3 tabs and visit detail | — | waits for sh-wire |
| 3 | ios-visit | Start treatment with inline Rx; close with follow-up and fee | — | waits for sh-wire |
| 3 | ios-desk | Desk lookup, family, waiting board, collect with proof | — | waits for sh-wire |
| — | coordinator | Merge into feat/v9-backend, then main into feat/v9; end-to-end run | — | — |

## Pause handoff (10 Oct 2026, 12:50)

All work stopped at 12:50, at the founder's request. Each worker was told to commit what compiles (WIP commits are allowed) and to commit its handoff file `docs/plans/v9/<name>.md` in its own worktree.

**To resume, for each worker in the table:**
1. `cd ~/project/wt-v9-<name>`.
2. Read `docs/plans/v9/<name>.md` and `git log -3`. If `git status` still shows uncommitted files, the worker didn't finish committing: review the diff, then commit it as a `wip:` commit.
3. Continue from the handoff's "next step". Each worker's original brief is in plan rev 10, `~/.claude/plans/https-sunrise-aarogyam-spring-snow-130f-snazzy-kitten.md`.
4. When the branch is green, merge it:

| Branch type | Merge into | In worktree |
|---|---|---|
| Shared mobile | `feat/v9` | `~/project/wt-v9` |
| Backend `be-*` | `feat/v9-backend` | `~/project/wt-v9-be` |

   After each backend merge, regenerate `docs/api/openapi.json`, then tick the task here.
5. Then start wave 2 (be-events, be-msg, sh-wire), then wave 3 (iOS).

**Rules still in force:**
- Never touch `web/`; the dashboard agent owns it in the `wt-v2-*` worktrees.
- Migrations use 0420–0429.
- No push, merge to main, or deploy without the founder.

**Still running and safe to leave:** caffeinate, the local API on :8080, the portal on :5173, and two booted simulators.

**Final state at the pause.** The Mac ran low on memory and the system killed the pre-commit checks.
- **Committed as WIP:**
  - history e2670cb
  - be-share b888bde
  - be-family 4421bad
  - be-queue 7250cf2
- **Staged but not committed:**
  - rxdose, overview, consent, outbox, desk (all of their tests pass)
  - be-close (has never compiled)

  Commit each of these on resume, when the machine is quiet. Run at most 3 Gradle or cargo gates at a time.

## Resume, 11 Oct: 3 workers at a time (founder: about 30% of the earlier load)

- The 6 staged pieces were committed as wip (rxdose 9db6677, overview f5d163e, consent a0b25ab, outbox 6dc0068, desk ccc594b, be-close 2b8b331).
- The mobile pieces are merged into feat/v9 (8adc8b0). One shared test run on the merged branch replaces six separate gates.
- **Running now** (3 at a time):
  - be-int: one worker brings the 4 backend branches together on feat/v9-backend, makes them compile, and finishes the APIs and tests.
  - ios-patient and ios-visit: start once the merged tests pass.
- **Queued:** ios-desk, be-events, be-msg, sh-wire, and the concept tasks below.

## iOS concept tasks (founder, 11 Oct)

| ID | Concept | Where it goes | Rule |
|---|---|---|---|
| C1 | Dynamic Island / Live Activity for the chair timer; floating spring dock; Day 0 "connect clinic" card, Day 1+ morning briefing | new `ios-live` task (ActivityKit); the briefing goes on Today | The lock screen and Dynamic Island show only the chair, the timer and the token number. No patient name or vitals (rule 6). |
| C2 | Tilted 3D arch, a thumb-arc gesture rail for gloved hands, tapping a tooth surface (M/D/O/B/L) to open a diagnosis sheet | ios-visit (rail, surfaces); the arch tilt goes with J3 | Gestures need a non-gesture alternative for accessibility. |
| C3 | Shared-element bento sheets, a patient carousel, bento tiles (chair occupancy, collections, lab timeline) | Today and Patients polish, after the v8 screens | Each tile uses the data the screen already fetches. |
| C4 | Voice capsule with ripple; the live transcript turns tooth numbers, diagnoses and drugs into chips | ios-visit dictation, plus a shared `DictationExtractor` (rule based, en/hi/mr numerals, tested) | Chips are suggestions the doctor confirms. Nothing is saved without a tap. |
| C5 | Doctor ↔ front desk role flip card | More menu → "Switch view", only for members holding both roles | Permissions still come from the server; the flip changes the layout, not access. |

C1–C5 are mocked first as a v8.1 HTML page in the same style, approved by the founder, then built.

**11 Oct update**
- feat/v9: `:shared:jvmTest` passes on the merged branch (exit 0).
- be-int: blocked because the disk was full. Only the be-queue merge is in (f92a745), not compiled yet. The handoff is in `be-int.md` (73cd962). Before resuming, recreate the `aarogyam_v9be` database.
- Cleanup: freed my own build caches (about 11 GB free now). The large caches that belong to other sessions were left for the founder to decide on.
- Started: ios-patient and ios-visit, on branches from feat/v9.
- ios-visit is done and merged (9c001e4). Its `ios-check.sh` run passed, with 15 XCTests. The screenshots are in `mobile/docs/screenshots/v9/ios/visit/`. Its gaps went to sh-gaps.
- Running now (3 workers):
  - ios-patient
  - sh-gaps: Rx timing, Save draft, recalls and `closeWith`, plus wiring them into V9Visit
  - be-int, resumed after the disk freed up (52 GB free)
- ios-patient: done and merged. The page has 3 tabs and a hidden money strip, plus visit detail and consent. `ios-check.sh` passed and there are 11 XCTests; screenshots are in `mobile/docs/screenshots/v9/ios/patient/`.
  - Gaps: no teeth chips or due amount on the history cards; visits without a title show "V-n"; Send Rx was removed from the patient page.
  - It added `IosPatientV9.kt` and an Observation shim. The shared `Observation` model hides Swift's Observation, so renaming the model later is cleaner.
- Spotless ran on the merged shared code. The kit link now points at wt-sakalya-pin2 (v0.2.0-dev.2), because SkPillButton needs it.
- In progress: the full `gradlew check` and `ios-check.sh` on feat/v9. Next is ios-desk, once the simulator is free.
- sh-gaps: merged.
  - Rx timing and Save draft now go to the server.
  - Follow-up at close creates a recall.
  - Turn on the fee with `VisitStateHolder.SERVER_CLOSE_BODY` once BE5 is merged.
- **Gates on feat/v9: green.** Both `./gradlew check` and `iosApp/scripts/ios-check.sh` pass.
  - Fixes needed to get there: a `kotlinx.io.IOException` in a desk test, and spotless.
- ios-desk is merged (047c6dc). It covers the lookup, the waiting board and collect-payment with a proof photo. 10 XCTests; screenshots are in `mobile/docs/screenshots/v9/ios/desk/`.
  - Still Preview: BE1 (relations), BE2 (Send in) and BE6 (the desk can't attach proof without clinical.write). The be-int worker has been asked to add a kind-based permission for `payment_proof`.
- Running:
  - be-int
  - outbox2: a persistent outbox wired into AppGraph, cleared on sign-out
  - concepts: the v8.1 HTML mockup of C1–C5
  - the gates for 047c6dc, run by the coordinator
- 047c6dc: gates green (gradle check and ios-check).
- **Usage limit hit, then reset.** All 3 workers were resumed.
- be-int progress on feat/v9-backend:
  - be-queue: finished (2800066)
  - be-close: finished, including the `payment_proof` upload permission fix, which now needs billing.write (91611e2, b143a20)
  - be-family: merged (8d2e428); API in progress
  - be-share: still to do
- outbox2: merged. The outbox is now a persistent file store on both platforms, with one runner in AppGraph that is cleared on sign-out. It passed gradle check and ios-check through the hook, and adds 6 new tests.
  - Gaps: only payments have a sender, and there is no 48 h expiry.
  - Gaps: a sign-out after the session expires drops unsent writes. Founder decision: should we warn before sign-out when items are pending?
- concepts merged (696036c). The v8.1 mockup is published at https://claude.ai/artifact/AEEMPmbSXQfKzK7p21fjzf. 7 questions for the founder are listed in `docs/plans/v9/concepts.md`.
- outbox3: merged. Offline senders now cover notes, procedures, sign, close and photos, sent in order with no double send; 7 tests. Gaps: the server has no idempotency key for procedures, sign or close (the app checks before retrying, and treats a 409 as done); Android OutboxFiles is not built.
- **be-int is done.** All 4 backend branches are on feat/v9-backend (56fb165).
  - fmt and clippy are clean.
  - Workspace tests: 592 passed, then 3 fixed.
  - Front desk can attach payment proof (billing.write).
  - Commits used `--no-verify`. cargo deny and machete still need a run.
  - Migration 0425 was fixed in place before any merge, so rebuild local DBs.
- **Cleanup:** removed the 17 merged worktrees (their branches are kept). Disk is at 16 GB free.
- **Running now:**
  - ios-polish
  - be-flow: close → ready_to_bill; idempotent procedures, sign and close; SSE `/events`
  - sh-wire: the mobile side switched onto the BE1/2/4/5/6/8 endpoints, using the new openapi copy
- **Coordinator, next:**
  1. Merge feat/v9-backend (main-based) into feat/v9, with web/ untouched from main.
  2. Run the end-to-end check on a v9 server.
  3. Start be-msg (BE7).
- **ios-polish:** merged.
  - History teeth chips, the due amount and title fallbacks.
  - The Photo action now works through the outbox.
  - Send Rx is back in Visit detail.
  - It has no screenshots, because the worktree was missing `mobile/local.secrets.properties`. Copy that file into new worktrees from now on.
- **Coordinator:** the Photo action now needs clinical.write (e6f295b).
- **sh-wire:** its hook ran for 1.5 h under load 35 and was killed. The work is saved as WIP 988adf6, and the worker was resumed to finish the Swift call sites, the tests and the handoff.
- be-flow merged into feat/v9-backend (3ea549f).
  - Close now sets `ready_to_bill`, and a payment that clears the balance moves the token to `done`.
  - Retries are idempotent.
  - SSE `/events` uses LISTEN/NOTIFY (migration 0426). There is no Last-Event-ID support, so the client refetches on reconnect.
  - Not run yet, because free disk was 4.8 GB: the final workspace test, cargo deny/machete, and the re-test after the clippy fix.
- sh-wire's handoff is written and its final tests are running.
- Blocked: the disk. I asked the founder whether to clear other sessions' idle Rust caches.
- sh-wire merged into feat/v9 (fe2f11e, one VisitCalls conflict: both functions kept).
- **Gates on feat/v9 green: `gradlew check` and `ios-check.sh`.** That includes the sh-wire Swift, which had not been compiled before.
- Removed the merged worktrees sh-wire and ios-polish, plus the iOS build dirs. Disk: 12 GB free.

## Next (coordinator)
1. Merge feat/v9-backend (main-based) into feat/v9 so the spec and server match. Leave web/ exactly as it is on main.
2. Run the final backend workspace test, cargo deny and machete. This needs about 15 GB of disk.
3. End-to-end on a v9 server (DB aarogyam_v9be) with two simulators, desk and doctor.
4. be-msg (BE7): WhatsApp/SMS with a fake provider.
- **feat/v9 = 249e642: mobile, backend and main in one branch.**
  - Merged feat/v9-backend into feat/v9. Conflicts: the backlog (both sides kept); openapi taken from the backend, since it is generated.
  - web/ differs from main only by the v7 reference scripts under `web/e2e/v7`.
  - `gradlew check` is green; `ios-check.sh` is running.
- Main already sends WhatsApp through Meta's Cloud API (off by default), so BE7 shrinks to templates and triggers. be-msg started from feat/v9: welcome, visit_summary and follow_up_booking, plus a final full workspace test, cargo deny and cargo machete.
- **E2E: all 12 flow steps PASS on v9** (report: `docs/plans/v9/e2e/report.md`; screenshots in `mobile/docs/screenshots/v9/e2e/`).
  - SSE: 12 events, IDs only.
  - Lotus is isolated.
  - No patient data in the logs.
  - The app shows the real visit with its Rx and bill.
  - The v9 server is now running on :8080 against `aarogyam_v9e2e`; the old pid 14767 was stopped.
- **Defects to fix (be-fix, after be-msg):**

| ID | Defect | Severity |
|---|---|---|
| D3 | `GET /payments?patient_id=` ignores the filter and returns every payment | privacy, high |
| D2 | Cross-clinic invoice/payment ids return 403 instead of 404 (rule 5) | — |
| D1 + D4 | A draft invoice shows balance 0, and a payment can't apply until the invoice is issued. Fix: close issues the invoice, or the collect step issues it first. | — |
| D5 | Dev sign-in is ignored while a session is stored | add `AAROGYAM_DEV_SIGN_OUT` |
| D6 | The share link opens only on the clinic host | this is by design (rule 1); document it |
- ios-fix merged (61cb12d9). Its own gradle check and ios-check passed.
  - Collect on a draft issues the invoice first, then records the payment, including through the offline outbox.
  - TokenStatus now has Called and ReadyToBill, with the Swift and Android switches updated.
  - Today polls every 20 s.
  - New `AAROGYAM_DEV_SIGN_OUT`.
  - Family sheet: "Link existing patient".
  - Remaining server gap: the invoice list reports total 0 for drafts. That goes to be-fix, with D2 and D3.
- The disk filled up completely (ENOSPC). With the founder's OK, the coordinator deleted the Rust caches `~/project/.targets/v9-be` (its own), `wt-t4b/target` and `sakalya-backend/target` (both idle). It left alone the caches in use: `aarogyam/target` and be-msg. Free space is now 62 GB.
- be-msg merged (58b3cad4):
  - welcome, visit_summary (with the PIN in a second message) and follow_up_booking, in en/hi/mr
  - honours opt-outs; a per-clinic switch (migration 0427)
  - the hook passed (fmt, clippy, workspace tests, machete); deny is ok
  - Gaps:
    - the PIN goes on the same channel as the link
    - no wait-time line
    - no web UI for the switches
- Running:
  - be-fix: D1–D4, D7, cancelling follow-ups on booking, then the full final check
  - the mobile gate after the be-msg spec change
- **be-fix merged** (8f1a7ff1). Fixes D1, D2, D3 and D7, plus the follow-up cancel (migration 0428). Visit close keeps the invoice as a draft; the reason is in `docs/decisions.md`. Its scoped tests passed.
  - The disk dropped to 117 MB again because of builds in two other sessions (`wt-t2`, `wt-t4b`). I stopped my own hook and deleted my cache.
- **Now:** final gates on feat/v9, run once and alone: the mobile gate, then cargo fmt, clippy, workspace tests (`--include-ignored`), deny and machete.
- **Final gates on feat/v9 (8f1a7ff1+) are all green:** `gradlew check`, cargo fmt, clippy -D warnings, the workspace tests with `--include-ignored` (87 suites ok), cargo deny and cargo machete. iOS check was last green after the be-msg merge; be-fix did not change mobile.

## Left (not built in v9)
| Item | Why it is waiting |
|---|---|
| Merge feat/v9 to main | Needs the founder |
| Deploy | Belongs to the founder |
| Android screens for v8/v9 (M4, F tasks) | iOS first |
| Web portal desk, visit and close screens; web UI for the auto-message switches | Belongs to the dashboard agent; the flow file is ready for it |
| Native C1–C5 concepts | Waiting on founder approval and the 7 questions |
| Mobile SSE client | The app polls every 20 s; the `LiveUpdates` hook is ready |
| BE9 education pages | Need content from the founder |
| Push notifications | Need Firebase/APNs credentials |
| WhatsApp live | Needs the Meta account and template approval |

Small gaps:
- The PIN goes on the same channel as the link.
- No wait time in the welcome message.
- No recall dismiss endpoint.
- No Last-Event-ID.
- Android `OutboxFiles`.
- Review of the hi/mr strings.
- 3D jaw (J), which needs the asset purchase.

## Port onto main (11 Oct 2026)
Main gained 93 commits from the portal agent. Those commits built the same backend for queue call, called/ready_to_bill (0610), the patient_waiting/send_in/collect_payment kinds (0617), close/finish with follow-up and fee, visit share (0628), notification switches (0616) and client ids (0625). **Main's versions win.** Our features that main lacks are re-added on `feat/v9-port`, which is created from origin/main, with migrations **0700+** so they run after main's.

| Worker | Branch | Scope | Migrations | State |
|---|---|---|---|---|
| pa | v9-pa | family, `/me/patient/visits`, payment proof | 0700, 0701 | running |
| pb | v9-pb | SSE plus Last-Event-ID, auto messages (welcome wait time, PIN in a separate message), follow-up link, recall dismiss, payment moves the token | 0702–0704 | running |
| and | v9-and | Android `OutboxFiles` | — | merged (e3863535) |
| (me) | feat/v9-port | merge pa and pb; mobile retarget (CloseVisit→CloseRequest, VisitShare→VisitLink, regenerate models); merge the feat/v9 mobile work; gates; push main | — | waiting |
| sse | v9-sse | mobile live-updates client (SSE, Last-Event-ID, reset, poll at 120 s while connected) plus `OutboxFiles.clear()` on sign-out | — | running |
