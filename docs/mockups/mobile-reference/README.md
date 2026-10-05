# Aarogyam Mobile — Kotlin Multiplatform + Compose + SwiftUI

Starter project for the Aarogyam Clinic OS mobile apps, following the
architecture in the Aarogyam Blueprint:

- **`:shared`** — pure-Kotlin shared module: domain models, the white-label
  theme engine, and the repository contract. No platform dependencies, so
  `cargo check`-style fast rebuilds: a change here recompiles in seconds.
- **`:androidApp`** — Jetpack Compose (Material3) UI driven by the shared
  palette. Desk-heavy work stays on web; the app covers Today, Patients,
  Calendar and Patient 360.
- **`iosApp/`** — SwiftUI views consuming the shared framework. Same models,
  same theme math, native iOS patterns (NavigationStack, segmented Picker,
  sheets).

## Agent rules baked in

- **Strong types** — `PatientId`, `AppointmentId`, `ToothFdi` are `@JvmInline`
  value classes; raw strings never identify domain objects. `ToothFdi`
  validates FDI numbering in `init`.
- **No force unwraps** — Swift uses `if let` / optional binding throughout;
  Kotlin avoids `!!` entirely.
- **Money as integer paise** — `Bill.amountPaise: Long`, formatted at the UI
  edge only.
- **Theme as data** — `paletteFor(brandArgb)` derives brand-dark/soft tints;
  per-clinic white-labelling is a colour choice, never a redesign.

## Screens included (dummy data mirrors the HTML mockups)

| Screen | Android | iOS |
|---|---|---|
| Today (stats, up-next hero, schedule, alerts) | `ui/today/TodayScreen.kt` | `Views/TodayView.swift` |
| Patient 360 (hero, flags, Chart/Visits/Rx/Bills) | `ui/patient/PatientDetailScreen.kt` | `Views/PatientDetailView.swift` |
| 32-tooth FDI chart | `ui/chart/ToothChart.kt` | `Views/ToothChartView.swift` |
| White-label theme | `ui/theme/ClinicTheme.kt` | `Theme/ClinicTheme.swift` |
| Data (fake, mirrors mockups) | `shared/.../data/ClinicRepository.kt` | — (via Shared framework) |

## Build

### Android
Open in Android Studio (Ladybug+), let Gradle sync, run `:androidApp`.

### iOS
1. In Android Studio: run the `linkDebugFrameworkIos` / `embedAndSignAppleFrameworkForXcode`
   Gradle task (or use the KMP Xcode plugin) to produce `Shared.xcframework`.
2. In Xcode: create an iOS App target, add the Swift files under `iosApp/`,
   embed the framework, `import Shared` — the views compile against it.

### Wiring the real backend
Implement `ClinicRepository` against the Axum API (host-derived tenant,
`Require<PatientsRead>`-style permissions, `app.tenant_id` RLS). Swap
`FakeClinicRepository()` for the real one in `MainActivity` / the SwiftUI
`App` entry point — the UI doesn't change.

## Versions
Kotlin 2.1.20 · AGP 8.7.3 · Compose BOM 2025.01.00 · minSdk 26 · iOS 17+
