# T13: Android catch-up to the iOS app (15 Nov 2026)

The goal is that Android does everything the iOS staff app does, so both can ship to the stores. The shared Kotlin code (`mobile/shared`) already holds every state holder and API call. T13 is **Compose UI only**: port each iOS screen to Compose, reading the same shared holders. Move logic into `shared` only if iOS also has it in Swift and Android needs it too. In that case, move it to commonMain, keep iOS working, and add a commonTest.

## Areas: one worker each, its own worktree and branch, from base `17f97515` plus the route stubs

| Area | Worktree / branch | iOS reference (`mobile/iosApp/AarogyamStaff/Screens/`) | Android files it owns (`mobile/androidApp/src/main/`) |
|---|---|---|---|
| desk | `wt-v11-and-desk` / `v11-and-desk` | `V9Desk/*`, `IntakeV10/*`, `Routes+V9Desk.swift`, `Routes+V10Desk.swift`, `Routes+V10Intake.swift`, `WalkInScreen.swift` | `kotlin/.../ui/desk/**`, `ui/walkin/**`, `res/values*/strings_desk.xml` |
| visit | `wt-v11-and-visit` / `v11-and-visit` | `V9Visit/*`, `Chart/*`, `Routes+V9Visit.swift`, `RxSheet*.swift`, `DoctorV10/ChairModeView.swift`, `DoctorV10/DoctorWrapUpSheet.swift` | `ui/visit/**`, `ui/chart/**`, `ui/RxSheet.kt`, `res/values*/strings_visit.xml` |
| patient | `wt-v11-and-patient` / `v11-and-patient` | `V9Patient/*`, `PatientV7/*`, `Patient360Screen.swift`, `PatientsScreen.swift`, `BillingTab.swift`, `Routes+V9Patient.swift`, `Routes+B.swift` | `ui/patient/**`, `ui/Patient360Screen.kt`, `ui/PatientsScreen.kt`, the old tabs (`RxTab`, `NotesTab`, `FilesTab`, `BillingTab`) if the v9 page replaces them, `res/values*/strings_patient.xml` |
| clinical | `wt-v11-and-clinical` / `v11-and-clinical` | `Clinical/*` (chat with B7 notices, pinned, Everyone, photos; team; analytics; expenses), `Labs/*` (B7 tracker, vendor line, Remind all) | `ui/clinical/**`, `ui/labs/**`, `res/values*/strings_clinical.xml` |
| shell | `wt-v11-and-shell` / `v11-and-shell` | `MainTabs.swift`, `RootView.swift`, `MoreScreen.swift`, `Routes+A.swift`, `Routes+V10Doctor.swift`, `Routes+V10Tasks.swift`, `Routes+V10Live.swift`, `DoctorV10/DoctorWaitingCard.swift`, `TasksV10/*`, `LiveV10/*`, `TodayV7/*`, `TodayV10Logic.swift`, `ScheduleV7/*`, `Auth/*` | `ui/AppRoot.kt`, `ui/MainScreen.kt`, `ui/MoreScreen.kt`, `ui/TodayScreen.kt`, `ui/today/**`, `ui/ScheduleTab.kt`, `ui/SignInScreen.kt`, `ui/doctor/**`, `ui/tasks/**`, `ui/live/**`, `AndroidManifest.xml`, `res/values*/strings_shell.xml` |

## The contract between areas

- Each area has `ui/<area>/<Area>Routes.kt` with `fun NavGraphBuilder.<area>Destinations(graph: AppGraph, clinic: () -> ClinicContext?, nav: NavController)`. `AppRoot` already calls all four.
  - Add your `composable(...)` routes inside it.
  - Add `fun NavController.open<Thing>(...)` openers next to it for the other areas to call. Don't rename the existing ones.
- Openers other areas need. Add each with exactly this name and signature, even if its body starts simple:

  | Area | Openers |
  |---|---|
  | patient | `openPatient(id: String)` (exists) |
  | visit | `openVisitFromQueue(tokenId: String)`, `openVisitForPatient(patientId: String)` (as iOS `VisitRoute.fromQueue` / `.fromPatient`) |
  | desk | `openDeskIntake(phone: String?)`, `openDeskPayment(tokenId: String, invoiceId: String?)`, plus a composable `DeskHome(graph: AppGraph, clinic: ClinicContext, nav: NavController)` that the shell shows as the desk role's Today (as iOS `RoutesV10Desk.home`) |
  | clinical | `openLabs()`, `openChats()`, `openChat(id: String, title: String)`, `openTeam()`, `openAnalytics()`, `openExpenses()` |

- The shell owns `MainScreen` and `AppRoot`. It shows the right home per role, as iOS `MainTabs.swift` does: desk gets `DeskHome`, a doctor gets the waiting card and Today, and so on. It calls the openers above. Until another branch lands, call them anyway; they exist as stubs after the coordinator's first merge.
- If you truly need a file another area owns, don't edit it. Write the need in your handoff file, and the coordinator will do it at merge.

## Rules (`mobile/AGENTS.md` and `../../sakalya-mobile/AGENTS.md` apply)

- **Match the iOS screen:** the same sections, order, states (loading, empty, failed, offline, not allowed) and actions. Use the kit's Compose components (`com.sakalya.mobile.designcompose.*`) and `SkTheme` tokens; look at existing `ui/today/*` and `ui/walkin/*` for the v7 look.
- **Strings:** en, hi and mr in your own `res/values/strings_<area>.xml`, `res/values-hi/…` and `res/values-mr/…`. Take the wording from the iOS `.xcstrings` tables, which already have hi and mr.
- **Holders:** `rememberHolder { graph.<factory>(clinic, …, it) }` (`ui/Holders.kt`). State comes from `collectAsStateWithLifecycle()`.
- **Privacy:** no patient data in logs. Use `Logger` only; no `println`, no `!!`. Files stay under about 300 lines.
- **Platform pieces:**
  - Camera and photos via `ActivityResultContracts` (copy `ui/walkin` and `ui/PhotoPrep.kt`).
  - Dictation via `SpeechRecognizer`, with the `RECORD_AUDIO` runtime permission.
  - Signature via a Compose `Canvas` exported to PNG.
  - WhatsApp and phone via `Intent`.
- **Tests:** add a JVM unit test for any Kotlin logic you add (`androidApp/src/test`, JUnit). Shared logic gets a commonTest.

## Builds: the machine is small (16 GB, 8 cores) and shared

- **Every** Gradle or Xcode run goes through the lock: `~/project/.targets/build-lock.sh <command>`. It runs one build at a time, and only when the load is under 60.
- Compile with `cd mobile && ~/project/.targets/build-lock.sh ./gradlew --no-daemon --max-workers=2 :androidApp:compileLocalDebugKotlin > log 2>&1`, then read the exit code plus a grep for `e: ` or `FAILED`.
  - Batch your edits, about one compile per screen, not per line.
  - Never run `./gradlew --stop`.
- Before committing, run `~/project/.targets/build-lock.sh ./gradlew --no-daemon --max-workers=2 spotlessApply :androidApp:lintLocalDebug :androidApp:testLocalDebugUnitTest` (lint treats warnings as errors).
- Commit with `--no-verify` (the coordinator runs the full gate at merge), in Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit after each screen that compiles and lints, so a usage-limit stop loses little.
- No emulator runs. The coordinator does the visual checks.

## Handoff

Keep `docs/plans/v10/android-<area>.md` up to date as you go:
- what is done, screen by screen against the iOS files;
- what is left;
- openers added;
- needs from other areas;
- the commits.

This file is how work resumes after a usage-limit stop: a new worker reads it and carries on.

## Merge checklist (coordinator)
- Delete the shell's `ui/*/…Stub.kt` files once the real openers are merged.
- Visit's `onCollect` in `ui/visit/VisitRoutes.kt` calls `nav.openDeskPayment(tokenId, invoiceId)` after the desk merge.
- Shell: `AarogyamApp.kt` passes `dictation = AndroidDictation(this)`; the manifest has `RECORD_AUDIO`, `CAMERA` and `POST_NOTIFICATIONS`.
- Clinical: `openAnalytics()` is a coming-soon page until the new analytics (`v11-analytics`) is ported.
- `SignInScreen.kt` (shell) vs `v11-store`'s compile fix: keep the shell's, with the Password step.
- Run the full gate after each merge; push only when it is green.
