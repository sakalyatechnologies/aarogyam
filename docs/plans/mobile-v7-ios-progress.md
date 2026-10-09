# Mobile v7 · iOS progress (branch feat/mobile-v7-ios)

Kept by the iOS worker; the main tracker (`mobile-v7-tasks.md`) is ticked on merge.

| Task | Commit | Notes |
|---|---|---|
| I1 | (this commit) | Shell: system TabView with NavModel tabs and v7 icons (template images from the art catalogue), glass toolbar bar action (walk-in / add expense), `tabBarMinimizeBehavior(.onScrollDown)` on iOS 26. Schedule tab = Queue / Day / Week (new heat map). More page (profile row, tile grid, list), stock page, avatar picker with on-device photo. `ArtView` draws the shared art catalogue (gradients in box units, theme roles, nested loops). v7 roles come from the clinic brand. |

## Deviations
- Tab bar icons are the v7 line icons rendered to template images; the selected state is the system's (per plan: iOS keeps the system TabView).
- Tiles whose page is not built yet open the "Preview" page until their task lands.

## Shared changes requested
- `ClinicBranding.roleTokens(systemDark)` in iosMain: Palette colours reach Swift boxed, so iOS reads the hex from their description (works, but fragile).
