# Mobile v7 · iOS progress (branch feat/mobile-v7-ios)

Kept by the iOS worker; the main tracker (`mobile-v7-tasks.md`) is ticked on merge.

| Task | Commit | Notes |
|---|---|---|
| I1 | 070c9ff | Shell: system TabView with NavModel tabs and v7 icons (template images from the art catalogue), glass toolbar bar action (walk-in / add expense), `tabBarMinimizeBehavior(.onScrollDown)` on iOS 26. Schedule tab = Queue / Day / Week (new heat map). More page (profile row, tile grid, list), stock page, avatar picker with on-device photo. `ArtView` draws the shared art catalogue (gradients in box units, theme roles, nested loops). v7 roles come from the clinic brand. |
| I2 | (this commit) | Walk-in in the v7 sheet (kit `skSheet`, `SkField`, `SkPillButton`): mobile, matches as rows, name, age and sex chips, allergy chips, doctor chips, consent toggle, warm "Add to queue"; done state with the check mark drawing on. Kit pinned to v0.2.0-dev.2. Local-only launch hooks (`AAROGYAM_DEV_SIGN_IN`, `_TAB`, `_SHEET`) for screenshots. |

## Deviations
- Tab bar icons are the v7 line icons rendered to template images; the selected state is the system's (per plan: iOS keeps the system TabView).
- Tiles whose page is not built yet open the "Preview" page until their task lands.

## Shared changes requested
- `WalkInState.Done.patientId`: the "Photo of old Rx / X-ray" button after a walk-in needs the patient to upload to (D14); hidden until then.
- `ClinicBranding.roleTokens(systemDark)` in iosMain: Palette colours reach Swift boxed, so iOS reads the hex from their description (works, but fragile).
