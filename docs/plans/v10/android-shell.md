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

## Left
- Schedule: booking sheet and iOS queue/day polish (ScheduleV7/BookingSheet) not ported.
- Sign-in v7: OTP boxes, welcome pager, registration, invite screens not ported (existing plain email/code screen remains).
- Remove unused `sh_` strings if lint reports UnusedResources.

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
