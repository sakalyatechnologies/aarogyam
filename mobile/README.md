# Aarogyam staff app

Kotlin Multiplatform shared code (`shared/`) and the Compose Android app (`androidApp/`). The iOS app (`iosApp/`, SwiftUI) comes later; `shared` already declares the iOS targets and an `AarogyamShared` framework. Design: `../docs/mobile-architecture.md`. Rules for agents: `AGENTS.md`.

What runs today: email-code sign-in (Supabase), the clinic picker (`GET /api/v1/me` on the app host, `GET /api/v1/session` on the clinic host) and Today (`GET /api/v1/today`), themed from the clinic's brand colour.

## Setup (once)

1. JDK 17 and the Android SDK: `export JAVA_HOME=/opt/homebrew/opt/openjdk@17`, and `mobile/local.properties` with `sdk.dir=/Users/<you>/Library/Android/sdk` (git-ignored).
2. The pinned sakalya-mobile (`sakalya-mobile.version`) into `mobile/.deps/`:
   ```sh
   scripts/mobile-deps.sh                                    # from GitHub
   SAKALYA_MOBILE_PATH=../sakalya-mobile scripts/mobile-deps.sh   # from a local clone
   ```
3. Supabase settings in `mobile/local.secrets.properties` (git-ignored; environment variables `AAROGYAM_SUPABASE_URL`, `AAROGYAM_SUPABASE_KEY` and `AAROGYAM_PROD_APP_HOST` win):
   ```properties
   supabase.url=https://<project-ref>.supabase.co
   supabase.key=<publishable (anon) key, the same one the portal uses>
   # prod.app_host=<app host on the product domain, once chosen>
   ```
   Without them the app opens on "This build isn't set up".

## Run in the emulator

Flavours pick the API: `local` (`http://<slug>.localtest.me:5173`, the Vite dev server, debug builds only), `demo` (`https://<slug>-aarogyam.spring-snow-130f.workers.dev`, app host `aarogyam-portal…`), `prod` (the host `/me` reports).

```sh
cd mobile
emulator -avd <avd> &                       # or start one from Android Studio
./gradlew :androidApp:installDemoDebug      # demo
# local: run the API in Supabase auth mode (ARO_AUTH__MODE=supabase) and `pnpm dev:portal`, then
adb reverse tcp:5173 tcp:5173               # the emulator's localhost:5173 reaches the Mac's
./gradlew :androidApp:installLocalDebug
```

Sign in with an invited email address and the emailed code. A person with one clinic goes straight to Today; pull down to refresh. Screenshots are blocked (`FLAG_SECURE`).

## Checks

| Task | Command |
|---|---|
| Shared tests on the JVM (fast) | `./gradlew :shared:jvmTest` |
| Format | `./gradlew spotlessApply` |
| Gate: tests on JVM, Android host and iOS simulator, Android lint (warnings are errors), ktlint | `./gradlew check` |

The pre-commit hook runs the gate when anything under `mobile/` is staged.

## API models

`shared` generates models from `../docs/api/openapi.json` at build time (OpenAPI Generator, `kotlin` / `multiplatform`, models only) into `shared/build/generated/openapi`, so they never drift from the committed spec. Add a schema to `apiModels` in `shared/build.gradle.kts` when a screen needs it, and a wrapper in `api/AarogyamApi.kt` (one request per screen where the API offers it).
