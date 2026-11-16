# T13 shell worker: handoff (15 Nov 2026)

Branch `v11-and-shell`. Android baseline already had Today v7, Schedule (queue/day/week), sign-in (email + code) and More v7; this work adds the v10/v11 pieces.

## Done (code written, see commits for what compiled and linted)
- MainScreen: takes `NavController`; Today per role (`ui/today/TodayTab.kt`): desk role gets `DeskHome`, doctor gets the "Waiting for you" card (`ui/doctor`), My tasks button + badge, bell with kind rows, QR sheet (zxing), avatar picker (illustrations or photo).
- More: profile row, tile subtitles, openers to clinical area, Stock page and Help page (`ui/more`), Language, Sign out with unsent-writes dialog.
- Tasks sheet with photo proof, usage sheet, note sheet, confetti (`ui/tasks`).
- Live banner overlay over the whole signed-in app (`ui/live`); tap dismisses and returns to main.
- Manifest: RECORD_AUDIO, CAMERA, POST_NOTIFICATIONS, optional camera and microphone features.
- Shared: `DoctorWaitingHolder` moved from iosMain to commonMain (`shared/.../DoctorWaiting.kt`) with a commonTest; the iOS `doctorWaiting(screen)` extension stays in `IosDoctorV10.kt`.
- Strings: `strings_shell.xml` en/hi/mr, all names prefixed `sh_`.

## Also done after merging v11-store
- Sign-in: "Use a password" step with masked field (`ui/PasswordField.kt`) and way back to the code; More: Delete account sheet with confirm (`ui/more/DeleteAccountSheet.kt`).

## Left
- Remove unused `sh_` strings if lint reports UnusedResources.
- Desk role's Walk-in action should call `openDeskLookup()` (AppRoot already routes the walk-in; check visually).

## Second pass (wt-v11-and-shell2, 15 Nov)
- Schedule (`ui/schedule/*`, `ui/ScheduleTab.kt`): `QueueV7` + `QueueChairs` (chair board, free chairs, waiting tickets with live timers, summary chips, preview notices), `DayV7` + `DayColumns` (week strip, doctor/chair columns, lanes, now line, appointment sheet), `WeekV7` (heat map card, busiest hour, open-slots preview), `BookFlow` (patient picker, then the shared `BookingStateHolder` with doctor, day, kind, chair, slot chips and reason). Maths in `ScheduleLogic.kt` (`QueueBoard`, `DayGrid`) with `ScheduleLogicTest`. The Queue segment has the waiting-room board entry row (`openDeskBoard()`); the book button sits beside the segmented control.
- Sign-in v7 (`ui/auth/*`, `ui/SignInScreen.kt`, `ui/SignInSteps.kt`): welcome pager, `SignedOutFlow`, 8-box `OtpBoxes` (hidden field with SMS one-time-code autofill semantics), registration, invite screen (signed out and signed in), password step kept. `aarogyam://invite#token` intent-filter in the manifest, `PendingInvite` holds the link in memory only (never logged or stored); AppRoot shows the invite screen when signed in with a pending link. MainActivity is `singleTask` with `onNewIntent`.
- Doctor Today: "Waiting for you" shows 3 rows then "+N more waiting"; `WaitingForMe` (in memory) adds the doctor's waiting tokens to the me-card count.
- Bell rows use `DeskAlert.detail` from desk.
- Strings: `sh_s_*` (schedule and auth) and `sh_dv10_waiting_more`, generated from the iOS xcstrings by `scratchpad/shell2/addstr.py`.

## Stubs (coordinator deletes at merge)
- `ui/desk/DeskHomeStub.kt`: `DeskHome(graph, clinic, nav)`.
- `ui/visit/VisitOpenersStub.kt`: `openVisitFromQueue(tokenId)`.
- `ui/clinical/ClinicalOpenersStub.kt`: `openLabs/openChats/openTeam/openAnalytics/openExpenses` and `ExpensesPage(graph, clinic, showsAdd)`.

## Needs
- clinical: expose `@Composable fun ExpensesPage(graph, clinic, showsAdd: Boolean)` for the finance Expenses tab.
- Manifest now declares CAMERA: every `TakePicture` caller (FilesTab, visit, walk-in) must request the CAMERA runtime permission first, or the camera intent throws SecurityException.
- Added dependency `com.google.zxing:core:3.5.3` (libs.versions.toml, androidApp/build.gradle.kts).
- Desk role's My tasks button is overlaid top-end on `DeskHome`; check visually against the desk header.

## Visit needs
- RECORD_AUDIO is already in the manifest (done).
- `AarogyamApp.kt`: not wired here. At merge pass `dictation = AndroidDictation(this)` to `AppGraph.create` (class lands with the visit merge); no stub added because this branch compiles without it.
