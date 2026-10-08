# AGENTS.md: aarogyam/mobile

The Aarogyam staff app: Kotlin Multiplatform shared code (`shared/`), the Compose Android app (`androidApp/`) and the SwiftUI iOS app (`iosApp/`, XcodeGen `project.yml`, the shared framework through SKIE). The patient app follows the same layout in `patientShared/`, `patientApp/` and `patientIos/` (README, "Patient app"); its gate is `patientIos/scripts/ios-check.sh` plus the same `./gradlew check`.

## Read before writing code

1. `../docs/mobile-architecture.md`: modules, API rules, session, offline, security, gates. Decisions there are not reopened in code.
2. `../../sakalya-mobile/AGENTS.md` (or `.deps/sakalya-mobile/AGENTS.md`): its hard rules apply here too (tests with `MockEngine`, failures as `Outcome`, no `!!`/`println`, versions only in `gradle/libs.versions.toml`, telemetry through `Logger`).
3. `../AGENTS.md`: the product rules. The ones that bite on a phone:
   - **No patient data in logs, analytics, crash reports or notifications.** Log IDs and codes only.
   - **The clinic comes from the host.** Call `https://<clinic host>/api/v1/...`; never send the clinic in a header, path or body.
   - **Tokens live only in secure storage** (`SecureStore`), never in preferences, files, logs or `BuildConfig`.

## Rules

- `shared` holds every rule and state holder; UI code renders state and forwards intents. Shared code emits states and enums, never user-facing text; strings live in Android resources (and the iOS String Catalog).
- **Keep API calls per screen low:** one request per screen where the API offers it (`/today`, `/session`), and reuse cached reference data (session, clinic list, brand) instead of refetching it.
- Generic code (no clinic concept) moves to `sakalya-mobile`.
- A screen file stays under about 300 lines.

## Commands

Run from `mobile/` with `JAVA_HOME` set to a JDK 17.

| Task | Command |
|---|---|
| Fetch the pinned sakalya-mobile | `../scripts/mobile-deps.sh` (`SAKALYA_MOBILE_PATH=../../sakalya-mobile` for a local clone) |
| Shared tests (JVM, fast) | `./gradlew :shared:jvmTest` |
| Install the debug app | `./gradlew :androidApp:installLocalDebug` |
| Format | `./gradlew spotlessApply` |
| Gate (tests, lint warnings-as-errors, ktlint) | `./gradlew check` |
| iOS app build and XCTests (simulator) | `iosApp/scripts/ios-check.sh` |

## Done means

- [ ] `./gradlew check` and `iosApp/scripts/ios-check.sh` pass (the pre-commit hook runs both when `mobile/` is staged).
- [ ] Swift: no `print` or `os_log` of patient data; copy in `Localizable.xcstrings`.
- [ ] New state holders and endpoint wrappers have `commonTest` tests.
- [ ] Small Conventional Commits.
