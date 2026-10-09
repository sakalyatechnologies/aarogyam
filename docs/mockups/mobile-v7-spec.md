# Mobile v7 spec

The native staff apps (Compose and SwiftUI) are built to match `docs/mockups/mobile-v7.html` (the founder-approved mockup) exactly. This file and `mobile-v7-spec.json` are the reference. If the mockup and this file disagree, the mockup wins: re-run the extractor. The plan and task list are in `docs/plans/mobile-v7-tasks.md`.

- Regenerate the measured values with `node web/e2e/v7/extract-spec.ts`. It writes `mobile-v7-spec.json` with tokens for 6 palettes × 2 modes, plus computed styles of key elements per platform.
- Reference renders per sheet ID: `node web/e2e/v7/render-reference.ts` writes to `mobile/docs/screenshots/v7/reference/`.

## Units
The mockup draws each phone on a **340 px wide canvas** (a 360 px frame less 10 px padding each side).
- **1 mockup px = 1 dp on Android and 1 pt on iOS.**
- Layouts must reflow from 320 to 480 dp wide; the mockup sizes are for the 340–360 dp case.
- Nothing uses a fixed screen width. Widths come from weights, `fillMaxWidth` and `maxWidth`.

## Theme tokens (from `tokens()` in the mockup)
Input: the clinic brand colour, converted to HSL `(h, s)`. Then:
- `sat = clamp(s, 35, 80)`.
- Tertiary hue `tH = 26` (saffron), unless the brand hue is already warm (10 < h < 60). In that case `tH = (h + 190) mod 360`.

| Token | Light | Dark |
|---|---|---|
| primary `--p` | hsl(h, sat, 30) | hsl(h, sat·0.7, 72) |
| primary2 `--p2` (gradient end) | hsl(h+18, sat·0.9, 40) | hsl(h+18, sat·0.7, 58) |
| onPrimary `--on-p` | #ffffff | hsl(h, sat, 14) |
| primaryContainer `--pc` | hsl(h, sat·0.7, 86) | hsl(h, sat·0.6, 26) |
| onPrimaryContainer `--on-pc` | hsl(h, sat, 14) | hsl(h, sat·0.7, 88) |
| tertiary `--t` | hsl(tH, 80, 54) | hsl(tH, 85, 62) |
| tertiaryContainer `--tc` | hsl(tH, 95, 89) | hsl(tH, 50, 26) |
| onTertiaryContainer `--on-tc` | hsl(tH, 80, 18) | hsl(tH, 90, 88) |
| background `--bg` | hsl(h, 22, 97) | hsl(h, 12, 7) |
| surface1 `--s1` | hsl(h, 20, 94) | hsl(h, 10, 11) |
| surface2 `--s2` | hsl(h, 18, 91) | hsl(h, 10, 14) |
| surface3 `--s3` | hsl(h, 16, 88) | hsl(h, 9, 18) |
| card `--card` (iOS cards) | #ffffff | hsl(h, 10, 12) |
| sheet `--sheet` | hsl(h, 22, 97) | hsl(h, 10, 12) |
| onSurface `--on` | hsl(h, 25, 10) | hsl(h, 10, 92) |
| onSurfaceVariant `--on-v` | hsl(h, 10, 33) | hsl(h, 8, 72) |
| outline `--ol` | hsl(h, 12, 80) | hsl(h, 8, 26) |
| error `--err` | #c62828 | #ff8a80 |
| errorContainer `--errc` | #ffdad6 | #5c1612 |
| onErrorContainer `--on-errc` | #410002 | #ffdad6 |

**Fixed colours in the mockup** become tokens (K2):

| Colour | Use |
|---|---|
| chart children / planned `#7c93f0` | chart series and planned status |
| treated `#5fbf98` | treated status |
| in progress `#e8833a` | in-progress status |
| watch `#e6bf2e` | watch status |
| live dot `#7dffb8` | pulse dot |
| tooth enamel gradient `#ffffff → #f4f1ea → #dcd6c8`, edge `#c9c2b1` | jaw teeth |
| gum `color-mix(#f3a7a7 50%, bg)` | jaw gums |
| dark schedule card `#0f1613` / text `#eef5f1` | "My schedule" card |

**Computed values** for all 6 presets (Tulsi, Ocean, Neem, Lotus, Indigo, Saffron) in both modes are in `mobile-v7-spec.json` under `palettes`. Kotlin tests compare the ported formula against them. The **`color-mix()` uses**, of the form `color-mix(in srgb, A n%, B)`, are listed in the "color-mix" section below. They are implemented as `mix(A, B, n)` in sRGB.

AA contrast is checked for every text pair. If a pair fails, the fix is logged under "Deviations" below with the adjusted value.

## Typography
- Display and headings: Plus Jakarta Sans (`.disp` and all `h*`).
- Body: SF on iOS (`-apple-system`) and Roboto Flex on Android.
- Base body size is 13 px (`.ph`).

Measured element sizes (see the JSON for all):

| Element | Size / weight / line height |
|---|---|
| Large title (`.nav .big`) | iOS 27/800, Android 25/800, line height 1.1 |
| Inline title | iOS 15/700, Android 17/700 |
| Kicker | 11, 700 (iOS, uppercase, 0.06 em) / 600 (Android) |
| Me-card greeting `h3` | 19/800, line height 1.05 |
| Hero name | 18/800; hero sub 12; hero kicker 10.5/700, 0.08 em |
| Stat number | 17/800; stat label 10.5 |
| Section header | 14.5/800 |
| List title | 13.5/700; list subtitle 11.5 |
| Pill | 9.5/800, 0.04 em |
| Chip | 12.5/600 |
| Button | 14/700 |
| Sheet title | 18/800 |
| Tab label | iOS 9.5/600; Android 11.5/700 (shown only on the active tab) |

These map to the kit's 13 styles in K3. Each element keeps its own measured size: the kit style is the nearest one, and the product overrides only where the mockup differs.

## Shape and spacing
- **Radii:**

  | Element | Radius |
  |---|---|
  | cards | 22 (iOS 20) |
  | hero, `.dark` | 24–26 |
  | me-card | 26 |
  | sheet | 32 top (iOS 38, floating, inset 8) |
  | chips | 10 (Android) / pill (iOS) |
  | buttons | pill; Android filled buttons morph to 16 when pressed |
  | tab bar | pill |
  | FAB | 18, morphing to a circle when pressed |
  | list groups | 22 outer, 8 inner |
  | stat group | 22 outer, 8 inner |

- **Screen gutter:** 16. Card padding 13–16. Section gaps 16 above and 7 below the header.
- **Touch targets:** at least 44 pt / 48 dp, even where the mockup draws smaller (chips are 32 tall visually, with padding to the target size).
- **Shapes:**
  - cookie: the 24-point star polygon `.shape` clip on Android avatars
  - morph blob: the border-radius animation between `42% 58% 63% 37% / 45% 41% 59% 55%` and `61% 39% 35% 65% / 58% 62% 38% 42%`, 8–9 s
  - me-card avatar: `36% 64% 58% 42% / 48% 40% 60% 52%` on Android

## Motion (from the mockup CSS and JS)
**Easing curves:**

| Name | Curve |
|---|---|
| spring | cubic-bezier(.34, 1.56, .64, 1) |
| emphasized | cubic-bezier(.2, 0, 0, 1) |
| decelerate | cubic-bezier(.05, .7, .1, 1) |
| iOS push | cubic-bezier(.32, .72, 0, 1) |
| exit | cubic-bezier(.3, 0, 1, 1) |
| bounce return | cubic-bezier(.34, 1.4, .64, 1) |

On native: springs use damping 0.62–0.75 and stiffness about 380–500 (tuned to match visually). Everything is off under reduced motion.

| Moment | iOS | Android |
|---|---|---|
| Root swap (welcome → sign-in → app) | fade + scale 1.04→1, 420 ms emphasized | fade + scale 0.9→1, 450 ms |
| Push | slide from the right 480 ms iOS curve; screen underneath to −30% and brightness 0.88 | shared axis X: +30% with fade, 420 ms; underneath to −30% and fade out, 300 ms |
| Pop | reverse, 380 ms | top +40 px, scale 0.92, fade out 260 ms; underneath returns 380 ms |
| Tab switch | crossfade 220 ms | fade-through: out 90 ms, in with scale 0.92→1, 300 ms |
| Segment or patient tab swap | fade 280–300 ms | fade + translate 8 px / scale 0.96→1, 280–380 ms |
| Tab bar on push / return | down 140%, 260 ms / up with overshoot, 480 ms | same |
| Tab bar on scroll down | shrinks to the active tab, spring 450 ms | slides away, 400 ms |
| Selected tab | sliding pill, spring 500 ms (deviation: system TabView) | active pill stretches to show the label, spring 450 ms |
| Large title collapse | past 34 px scroll | past 34 px scroll |
| Sheet open | spring 500 ms; page behind scales to 0.93, brightness 0.85, radius 30 | FAB-to-sheet container transform, 480 ms; other sheets spring 500 ms |
| Sheet drag-to-close | past 90 px | past 90 px |
| Edge back | left edge (14 px), follows the finger, commits past 33%, 30% parallax | either edge, scale 1→0.9, radius to 32, commits past 22% |
| Avatar flight (list → Patient 360) | 520 ms emphasized | 520 ms plus 60° rotation |
| Press | scale 0.955, spring 380 ms, brightness 0.94 | scale 0.955 plus ripple (0.16 opacity, 550 ms decelerate) |
| Stagger on first load | 60 ms steps, 520 ms rise of 18 px | same |
| Progress ring | stroke fill 1.2 s emphasized | same |
| Bars | grow 0.8 s spring, 45 ms stagger | same |
| Gauge | arc sweep 1 s, 150 ms stagger | same |
| Area | line draw 1.6 s; fill fades in after 0.4 s | same |
| Radar, heat map | pop-in 0.5–0.9 s spring | same |
| Split and meter bars | grow 0.9 s emphasized | same |
| Toast | in from the top, spring 500 ms; 2.3 s on screen | same |
| Decorative loops | morph 7–9 s, blink 5.5 s, bob 4.5 s, glow 2.2 s, float 5 s, rock 6 s, twinkle 2.4 s, pulse 1.8 s, opening-shape spin 1.4 s | same |
| Check mark | stroke draw 0.6 s after 0.15 s | same |

## Sheet IDs (screens and sheets; each has a reference render and a parity check)
| ID | Screen or sheet | Notes |
|---|---|---|
| W1–W3 | Welcome slides (tooth / family / implant) | refined vector art (founder choice) |
| W4 | Opening clinic | — |
| AU1 | Sign-in (email code; SMS and SSO as Preview) | — |
| AU2 | Code entry with autofill | — |
| AU3 | Register clinic | real `POST /registrations`; steps from the web `register-page.tsx` |
| AU4 | Invite (WhatsApp-style preview) | — |
| AU5 | Join clinic | — |
| T1 | Today, doctor: me-card | — |
| T2 | Today: my schedule card | — |
| T3 | Today: stats, hero, money | — |
| T4 | Today: up next and schedule | — |
| T5 | Today, finance (money) | — |
| P1 | Patients list | — |
| P2 | Patient 360 header and quick actions | — |
| P3 | Chart tab with the 3D jaw | 2.5D fallback in P3b |
| P4 | Visits tab | — |
| P5 | Rx tab | — |
| P6 | Bills tab (and the locked state) | — |
| C1 | Tooth sheet: history | — |
| C2 | Add treatment form | the founder's screenshot is the reference |
| V1 | Visit screen | not in the mockup; designed in the v7 language |
| V2 | Dictation active | not in the mockup; designed in the v7 language |
| S1 | Schedule: queue | — |
| S2 | Schedule: day | — |
| S3 | Schedule: week | — |
| M1 | More | — |
| M2 | Analytics (top) | — |
| M3 | Analytics (charts) | — |
| M4 | Analytics (expenses) | — |
| M5 | Stock | not in the mockup (`simplePage`); designs below |
| M6 | Lab work | not in the mockup (`simplePage`); designs below |
| M7 | Team | not in the mockup (`simplePage`); designs below |
| M8 | Team chat | not in the mockup (`simplePage`); designs below |
| M9 | Help | not in the mockup (`simplePage`); designs below |
| M10 | Switch clinic | — |
| M11 | Messages | Preview |
| SH1 | Walk-in sheet | — |
| SH2 | Booking sheet | — |
| SH3 | Rx sheet | — |
| SH4 | Rx sent | — |
| SH5 | Share sheet | — |
| SH6 | Expense sheet | — |
| SH7 | Avatar picker | — |
| SH8 | QR sheet | — |
| SH9 | Notifications | Preview |
| SH10 | Language | — |
| SH11 | Tooth sheet | same as C1 |

**Pages that only have the generic `simplePage` in the mockup** (M5–M9) use these list designs:
- **Stock:** list rows with a shaped icon, item name, "N left · reorder at R", and a status pill (LOW `n`, OK `d`). Data from `/stock/low`.
- **Lab work:** cases grouped by status, with a pill (READY `d`, AT LAB `b`, OVERDUE `n`). The case row shows the patient file number, tooth, work type and due date. Actions: Message lab (`wa.me`) and Mark received. Preview until the labs backend lands (T1 in `docs/handoff.md`).
- **Team:** the person's avatar or initials, name, role and an IN/OFF pill (from `/today` team and `/staff`). Tap opens the chat (Preview until T2).
- **Team chat:** thread list (Team group first, then direct chats), a bubble view and a composer in the v7 sheet style.
- **Help:** list rows for email, a WhatsApp link to Sakalya support, video guides; in-app chat is Preview.

## Data and API notes from S0.2
- **Rx sets are real:** they come from `medicine_sets` in the clinic quick picks (`clinic.reference.quickPicks()`), as the web `medicine-sets.tsx` uses them.
- **Rx print:** the web has `prescriptions/:id/print`. The app opens it in an in-app browser on the clinic host, signed in through the existing session handoff (`POST /api/v1/auth/handoff`, then redeem). That makes it real once D9 verifies the handoff works from the app. Otherwise it's Preview.
- **Dead code in the mockup:** `queue()` and `cal()` are never called (`renderTab` uses `sched`). Don't build them.
- **Labs, staff chat and notifications backend** is planned in `docs/handoff.md` (T1 labs, T2 staff chat, A notifications). The mobile repositories in D12 follow those planned endpoints. Until they're merged, the screens show Preview.

## Deviations (founder sign-off)
The table is kept in sync with the approved plan (`docs/plans/mobile-v7-tasks.md`, "Parity deviations"). Add new rows here when parity checks find something unavoidable.

| Found in | v7 shows | Native | Why |
|---|---|---|---|
| K2 palette | light primary at 30 % lightness for every brand | yellow-green brands (e.g. Neem `#4d7c0f`) step darker, to about 27 %, until white labels reach 4.5:1 | AA contrast; the other presets are unchanged |

## color-mix uses
Each is `color-mix(in srgb, A n%, B)` and becomes `mix(A, B, n)`.

| Where | Value |
|---|---|
| iOS nav collapsed, glass buttons | bg 70% / 50% / 45% / 40% over transparent, with blur 14–22 and saturate 1.8–2 |
| Badge and selection highlights | primary 14% (iOS tab selection), primary 25% (avatar selection ring), primary 18% (focus ring) |
| Bars | primary 40% over primaryContainer (fill); primary 9% over transparent (ghost track) |
| Heat map | primary at `v`% over surface2 |
| Me-card gradient | primaryContainer → mix(primaryContainer, tertiaryContainer, 55%) |
| Welcome background | radial mix(primary 26%, bg) → bg |
| Area gradient | series colour at 0.38 → 0 alpha |
| FAB shadow | tertiary 80% |
| Gums | `#f3a7a7` 50% over bg |
| Primary shadow | primary 70% (welcome art) |

## Dependency checks (S0.1, 9 Oct 2026)
- **Compose BOM 2026.09.00** pins `material3` 1.4.0 and **`material3-adaptive` 1.3.0**, so adaptive layouts (WindowSizeClass, list-detail) are in the BOM and compatible.
- **SceneView 4.53.0** (`io.github.sceneview:sceneview`, Maven Central) is built against Compose BOM 2026.09.00 and Kotlin 2.4.20, with Filament and gltfio 1.72.1. Its AAR has minSdk 24, at or below our 26. It's compatible, so it's used for the 3D jaw (J2).
- **`androidx.graphics:graphics-shapes` 1.0.1** (stable) is already a transitive dependency. Used for the cookie and blob shapes and the loading morph.
- **Baseline gates on `feat/mobile-v7`** with the kit worktree linked: `:shared:jvmTest` and `:androidApp:assembleLocalDebug` pass, and `iosApp/scripts/ios-check.sh` passes.
