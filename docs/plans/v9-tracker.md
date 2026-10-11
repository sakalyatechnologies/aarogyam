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
