# Aarogyam staff app v7: native build (Jetpack Compose + SwiftUI) · rev 6

## Context
**Why:**
- The founder approved the v7 mockup (https://claude.ai/artifact/1am9JUxEnDsMPYR2jG4oiM, copy `~/Downloads/aarogyam-mobile-v7.html`).
- They called the current app "very dull". The causes: no motion, one flat surface, text-link actions, heavy type, no imagery.

**Goal:** build v7 natively:
- Android in Compose, with the Material 3 Expressive look.
- iOS in SwiftUI, with Liquid Glass on iOS 26.
- On the existing architecture: shared KMP holders, the `sakalya-mobile` kit, and generated API models.

The work runs from the small-task tracker below. An independent reviewer approves it, then the founder approves the plan, then implementation starts. This is revision 6, after review rounds 1–6.

### Hard requirements (pass/fail)
- **H1 · Visual parity with v7:** colours, type, spacing, radii, shapes, icons, illustrations, avatars, charts, 3D jaw, bars, sheets, motion and transitions. Any unavoidable deviation is listed in the **Parity deviations** table and needs the founder's sign-off.
- **H2 · Founder additions not in the demo:**
  - tooth history with Edit
  - the Add treatment form from the founder's screenshot
  - Start treatment, leading to a Visit screen
  - multilingual voice bullet notes
  - New Rx
  - multi-clinic switching
  - labs: directory, cases and WhatsApp
  - team chat
  - real login, registration and invite link
- **H3 · Real backend data only:**
  - Where the backend lacks support, the UI is built completely on the same holder and repository layer, and shows a designed "Preview: needs server support" state: no fake rows, and disabled actions with a reason.
  - Previews are on in local and demo, off in prod, and each has a backlog item.
- **H4 · Every size:**
  - Android 320–480 dp compact, plus medium and expanded: a rail and list-detail.
  - Font scale 1.3.
  - iOS from iPhone SE to Pro Max, with Dynamic Type up to xxxLarge.
  - Done means no truncated primary text and no overlap, checked on contact sheets.
- **H5 · Best practices:**
  - tested holders
  - kit components on both platforms
  - the product-agnostic kit
  - tokens only
  - en, hi and mr strings
  - accessibility
  - files under 300 lines
  - one request per screen
  - small commits
  - green gates
- **H6 · Small tracked tasks:** the list below goes to `aarogyam/docs/plans/mobile-v7-tasks.md` and is ticked per commit. Each task states what is built, its tests, and the parity sheet ID it passes.
- **H7:** reviewer approval, then the founder's plan approval, then implementation.

### Verified facts (code and spec; rounds 1–4)
- **Material 3:** BOM `2026.09.00` gives material3 1.4.0, with no Expressive APIs. Stable `graphics-shapes:1.0.1` is cached. `material3-adaptive` compatibility is unverified.
- **Kit:**
  - Pinned tag checked out into the git-ignored `mobile/.deps/sakalya-mobile`; `iosApp/project.yml` points there.
  - Someone else's 0.1.3 work is staged in the kit.
  - Kit rules: product-agnostic (rule 1), tokens only (rule 9), both kits change together (rule 10).
- **`shared`:** targets android, ios and jvm; `AppGraph` has no Context. Shared code emits no user-facing text.
- **Android:**
  - One `NavHost` (`ui/AppRoot.kt`); `Int` tabs (`ui/MainScreen.kt`).
  - No motion, no UI tests. targetSdk 37, minSdk 26.
- **iOS:**
  - `MainTabs.swift` system `TabView`, `ScreenHost` with SKIE.
  - iOS 17 minimum, iOS 27 simulator runtime only. SakalyaUI also targets macOS 14.
- **Permissions:**
  - owner: everything (`analytics.view` is owner only).
  - doctor: clinical r/w, prescriptions.issue, billing.read; **no finance.view**.
  - consultant: assigned patients only.
  - front desk: no clinical.
  - assistant: clinical.read, intake.write.
  - finance: finance.view, expenses.write, billing; **no appointments.read**.
- **Endpoints:**

  | Endpoint | Notes |
  |---|---|
  | `GET /today` | needs appointments.read |
  | `GET /today/money` | needs finance.view |
  | `GET /expenses` | needs finance.view |
  | `POST /expenses` | needs expenses.write; no idempotency, method or attachment |
  | `GET /reports/analytics` | bucket week\|month, ≤ 731 days; chair_utilization, busy_hours (weekday×hour), age_bands, visit_kinds, money_visible |
  | `POST /queue/{id}/start-visit` | returns `StartedVisit`; one visit per appointment, used for queued patients |
  | `POST /patients/{id}/visits` | `NewVisit`, client id; only for patients with no token |
  | `POST /walk-ins` | already wrapped as `registerWalkIn` |
  | `/public/availability`, `POST /appointments`, `PATCH /appointments/{id}`, `/appointments/{id}/status` | booking |
  | visit notes | `POST /visits/{id}/notes`, `PATCH /notes/{id}` (SOAP `NoteContent`), `POST /notes/{id}/sign` |
  | `POST /visits/{id}/procedures` | status incl. planned |
  | `POST /visits/{id}/close` | — |
  | `POST /prescriptions/{id}/share` | fixed 7 days plus a PIN; no expiry choice, and no chart, X-ray or bill sharing |
  | `POST /registrations` | public, used by the web `register-page.tsx` |
  | invite email link | `https://<clinic host>/invite#<token>` |
  | `POST /invitations/accept` | signed in, matching email, app host |
  | `GET /staff`, `/stock/low`, `/suppliers` | suppliers is stock only; not for labs |

  There is no API for notifications, a messages inbox, labs, team chat, or avatar storage.
- **Chart:**
  - `NewChartEntry` needs a finding; surfaces are M/O/D/B/L only.
  - `crates/aarogyam-app/src/chart.rs` supersedes the current entry on the same tooth and surface.
  - The freeze trigger allows only current → superseded.
  - `ChartStateHolder` (430 lines) has history, terms, `addTerm`, `record` and `canRecord`. `ToothView.surfaceName` / `kind` give the labels.
- **Rx:** `RxValues.encounter_id` exists, but `RxSheetStateHolder` takes no visit. Quick picks come via `clinic.reference.quickPicks()`.
- **Web voice:** stores audio (migration 0120). The mobile app won't (decision 7).
- **Multi-clinic:** `/me` clinics, `ClinicPickerStateHolder`, host handoff. The local seed has Dev at Sunrise and Lotus.

## Decisions
1. **Expressive look in-house on stable APIs:** foundation, springs and graphics-shapes. No alpha material3.
2. **Navigation** (`NavModel`):

   | Who | Tabs | Action |
   |---|---|---|
   | clinical roles | Today / Patients / Schedule / More | Walk-in |
   | finance-only | Today (money) / Patients / Expenses / More | Add expense |

   **More tiles:**

   | Tile | Shown when |
   |---|---|
   | Analytics | `analytics.view` |
   | Expenses | finance.view |
   | Messages | Preview |
   | Stock | inventory.read; real `/stock/low` |
   | Lab work | clinical.read; Preview |
   | Team | staff list is real; chat is Preview |
   | Clinic QR | always; real clinic booking URL |
   | Rx sets | real if the API exists (checked in S0.2); else Preview |
   | Settings | opens the web settings in an in-app browser with the clinic host; no native settings |
   | Switch clinic | more than one clinic |
   | Language | always |
   | Help | static help with email and WhatsApp |
   | Sign out | always |

3. **Assets:**
   - The kit gets only a generic **path-command model plus renderers** (K5).
   - All v7 product art lives in `mobile/shared` as path data, parsed and drawn by both platforms: icon names (tooth, rx, flask…), avatars, `toothArt`, `familyArt`, `implantArt`, jaw geometry, blob and cookie.
   - The mockup's fixed chart and status colours (`#7c93f0`, `#5fbf98`, `#e8833a`, `#e6bf2e`) become **tokens** (K2).
   - **Fonts:**
     - Plus Jakarta Sans for display, already in the kit.
     - Roboto Flex for Android body, bundled with its OFL licence noted. SF for iOS body.
     - In the kit: a SakalyaUI resource bundle with `CTFontManager` registration.
4. **Theme:**
   - The brand colour comes from the clinic's branding (existing `ClinicBranding`), run through the ported v7 `tokens()` (HSL helpers in `ColorMath.kt`; web-parity functions untouched).
   - Dark mode follows the system.
   - The 6 presets are tested for AA.
   - The mockup's custom colour, palette and role toggles are design-time demo controls, not app features (listed in the deviations).
5. **Chart:**
   - `ToothSheetStateHolder` calls `ChartStateHolder`; `record(visitId)`.
   - The tested procedure → finding map (filling/inlay/onlay/sealant → filled; crown/veneer → crown; RCT/post-core → root_canal; implant → implant; extraction → missing; bridge → bridge; scaling and pulpotomy → visit procedure only).
   - Planned is a visit procedure with status planned, and only inside a visit.
   - Watch is a finding marked watch.
   - Edit on current entries: same surface uses the existing supersede; a surface change uses B1.
6. **Visit:**
   - Start treatment calls `queue/{id}/start-visit` when the patient has a token, otherwise `POST /patients/{id}/visits`.
   - The note is created once with a client id, then a debounced PATCH, then sign.
   - Bullets map complaint → S, finding → O, advice → P; dictation goes to S and can be retagged.
   - Rx from a visit passes `encounter_id`.
7. **Dictation:**
   - Adapters in the apps are passed into `AppGraph`; a fake in shared tests.
   - Android:
     - `RECORD_AUDIO` permission and a `<queries>` entry for RecognitionService.
     - The on-device recognizer on API 31+, otherwise `EXTRA_PREFER_OFFLINE`.
   - iOS: `SFSpeechRecognizer` with on-device recognition when supported.
   - Languages: en-IN, hi-IN, mr-IN.
   - No audio stored, which differs from the web; logged in decisions.md.
8. **Auth:**
   - Sign-in with the email code, using a 6/8-box code entry with autofill (`.oneTimeCode`; Android autofill hints).
   - Registration through `POST /registrations`.
   - **Invite:**
     - B2 adds "Open in the Aarogyam app" to the web invite page, launching `aarogyam://invite#<token>`; a pasted link also works.
     - Flow: sign in, then accept, then refresh the directory.
     - The token is kept in **memory only**, never logged or stored.
   - Mobile number OTP and Google/Apple sign-in are shown as Preview, with backlog items.
9. **WhatsApp:** messages to labs and patients use a `wa.me` deep link. The message text is built in platform strings, not shared code, and contains no patient name unless the user types it.
10. **Responsive:**
    - Android uses `WindowSizeClass`: `material3-adaptive` if it's compatible (S0.1), else `BoxWithConstraints` breakpoints at 600 and 840 dp.
    - Compact gets the floating bar; medium and expanded get a rail plus list-detail for Patients and Schedule.
    - iOS uses size classes and `ViewThatFits`; charts and the jaw scale to their width.
11. **Preferences:** an interface injected into `AppGraph` (SharedPreferences / UserDefaults; a fake in tests) for the avatar choice and dictation language.
12. **API budget:** one request per screen, reusing session, brand, practitioners, rooms and terms. Each A task states its calls.

## Parity deviations (founder sign-off needed; final list kept in `mobile-v7-spec.md`)
| v7 shows | Native build | Why |
|---|---|---|
| Mobile number + SMS OTP, Google/Apple sign-in | email code (real); the others shown as Preview | backend is email-only; SMS needs paid DLT |
| Analytics Week (7 daily bars) / Month / Year | Week = 12 weekly bars, Month = 12 monthly, Year = 24 monthly | API buckets are week or month only |
| Chair time Treatment/Consults/Admin, area chart by men/women/children | real chair utilization and busy hours, with the split shown as Preview | API lacks the split (backlog BK-4) |
| Doctor sees money cards | owner and finance only | doctor lacks finance.view |
| iOS floating Walk-in circle beside the tab bar | toolbar glass button; on iOS 26 a `tabViewBottomAccessory` was considered and rejected (full width) | system TabView rule, accessibility |
| Gujarati in the language list | en/hi/mr real; Gujarati listed as "coming soon" | no gu strings yet |
| Share sheet with expiry 1h/24h/7d and chart/X-ray/bill choices | Rx share real (7 days, PIN); the other choices Preview | API supports Rx only |
| Theme, role and custom-colour toggles at the top of the page | clinic branding and the system theme | demo controls only |
| Finance's 3rd tab is Analytics; doctors see the Analytics and Expenses tiles | finance's 3rd tab is Expenses; doctors see neither tile by default | `analytics.view` is owner-only and doctors lack finance.view (the owner can grant both in web roles) |
| iOS sliding selection pill inside a custom glass tab bar | system `TabView` selection (glass on 26) | kit rule: iOS bottom navigation stays the system TabView |
| Help: "Chat with Aarogyam" | Help page with email and a WhatsApp link to Sakalya support (real); in-app chat shown as Preview | no support-chat backend |
| Collect by UPI ("UPI request sent") | Preview; recording a payment uses the real `POST /payments` | no payment-link API (BK-13) |
| Seat next "in Chair 3" | seats the patient for real via `/queue/{id}/status`; choosing the chair is Preview | the status body has no room (BK-14) |
| Booked vs Walk-in split | Preview | `visit_kinds` has no booked/walk-in key (BK-19) |
| Treatment-mix radar by procedure category | radar over the 4 appointment kinds; categories Preview | API has kinds only (BK-4) |
| Patients number | labelled "patient visits" | buckets count visits, not unique patients |
| Rx Print | the web print route in the in-app browser if S0.2 confirms it; otherwise Preview | no print or PDF endpoint |
| 2.5D tilted oval jaw | **true 3D jaw** (orbit, lighting, tappable teeth); the 2.5D vector jaw stays as the fallback | founder decision (Pro feature, highest quality) |

## Work layout
- **Worktrees:** product `feat/mobile-v7` at `~/project/wt-mobile-v7`; kit `feat/design-0.2` at `~/project/wt-sakalya-design`, from the committed main. The staged 0.1.3 work is never touched.
- **Dev link:** a symlink from the git-ignored `.deps/sakalya-mobile` to the kit worktree.
- **Pinning:** local `v0.2.0-dev.N` pins before product commits; final `v0.2.0`.
- **No push or merge** until the founder settles the kit order.
- **Agents:** at most 3 at once. One per platform after K and D, each in its own worktree; the main session reviews each task against the spec sheet. hi/mr drafts go to the Codex worker and are reviewed.

## Task list (each ≤ ~1–2 h; commit per task; "Parity" = sheet ID in `mobile/docs/screenshots/v7/` passed)
**S0 · Setup and spec**
- **S0.1** Worktrees, symlink, `mobile-deps.sh`; baseline gates green. **Dependency checks, results recorded:**
  - `material3-adaptive` resolves against BOM 2026.09.
  - SceneView, or Filament + gltfio, resolves with Kotlin 2.4.20, AGP 9.4.1, compileSdk 37 and minSdk 26.
- **S0.2** Copy the mockup to `docs/mockups/mobile-v7.html`. Write `mobile-v7-spec.md` covering:
  - tokens and every `color-mix` value, computed by Playwright
  - type, spacing, radii, icon list, motion table
  - per-screen layout, including designs for the Stock, Team, Labs, chat and Settings pages (v7 only has the generic `simplePage`)
  - the deviations table above
  - the Rx-sets API check
  Done when every screen and sheet in the mockup is listed with a sheet ID.
- **S0.3** Reference-render script: v7 renders for each sheet ID at 320/360/390/430 widths, light and dark. Done when renders exist for every ID.
- **S0.4** Copy the tracker into the repo. Add backlog items:
  - BK-1: chart surface-change edit (done in B1)
  - BK-2: labs
  - BK-3: team chat
  - BK-4: analytics by sex, procedures by category, chair-time split
  - BK-5: expense method and photo
  - BK-6: expense idempotency
  - BK-7: notifications API
  - BK-8: messages inbox
  - BK-9: share expiry and record types
  - BK-10: avatar on server
  - BK-11: SMS OTP and Google/Apple sign-in
  - BK-12: App Links / Universal Links
  - BK-13: UPI payment link / collect request
  - BK-14: queue seat with a room
  - BK-15: month revenue target
  - BK-16: me-card extras (sterilisation cycles, day end estimate)
  - BK-17: queue summary stats (avg wait, no-shows), if `/queue` and `/today` don't already provide them
  - BK-18: support chat
  - BK-19: analytics booked vs walk-in split

  S0.2 also marks the mockup's unreachable `queue()` and `cal()` functions as dead code (`renderTab` never calls them), so nobody builds them.

**B · Backend and web** (before the tasks that depend on them)
- **B1** `NewChartEntry.supersedes_id` for surface-change edits in `aarogyam-app/src/chart.rs`. `cargo test`, openapi regeneration and regenerated models. Done when the API test for a surface-change correction passes. **Before D8 and A9.**
- **B2** Web `invite-page.tsx`: "Open in the Aarogyam app" plus a test. **Before A21.**

**K · Kit 0.2.** Every task: Compose and SwiftUI, light and dark previews, KDoc, unit tests, and a parity crop against the spec.
- **K1** `ColorMath` HSL helpers and tests.
- **K2** v7 tokens in `AppTheme` (including chart, status and the fixed mockup colours as tokens); tests for the count and AA across 6 presets × 2 modes; regenerate Swift tokens.
- **K3** Type scale (13 styles) and tests; Roboto Flex; SakalyaUI font bundle and registration.
- **K4** Motion tokens (durations, easing, springs, 60 ms stagger), `skPressable`, reduced motion.
- **K5** Generic path-command model, parser tests, and Compose/SwiftUI renderers.
- **K6** `SkAvatar` (slot and shape), `RoundedPolygon` cookie and blob morph, live pulse dot, badge dot, draw-on check mark, spinning shape, and the decorative loops (blink, bob, glow, float, rock, twinkle) as generic modifiers.
- **K7** `SkSegmented` (with swap animation), `SkChoiceChips`, `SkKeypad`.
- **K8** `SkStatGroup`, `SkTicket`, `SkLoadingIndicator`, `SkToast` (icon, message, spring).
- **K9** Chart geometry (pure, tested), `SkBarChart` (ghost tracks, grow-in, tooltip, selection), `SkSplitBar` (grow-in), `SkSparkline`.
- **K10** `SkGauge` (segmented arc sweep), `SkProgressRing` (fill on entry), `SkAreaChart` (gradient, line draw), `SkRadarChart` (pop-in), `SkHeatmap` (pop-in), `SkMeterBar` (`ebar`).
- **K11** `SkFloatingNavBar` (active pill stretch, trailing action, hide on scroll) and `SkCollapsingTopBar` (large to inline past 34 px), as documented Android-only exceptions; adaptive rail.
- **K12** Motion and feedback kit:
  - Android ripple; iOS highlight.
  - Sheet with drag-to-close past 90 px, and on iOS the page behind scaled to 0.93.
  - Edge-swipe and predictive back: Android from either edge with scale and corner radius; iOS from the left with a 30% parallax and the screen underneath dimmed to 0.88.
  - Container-transform helper.
  - Tab bar hiding on push and returning with an overshoot spring.
  - Staggered-entry modifier.
- **K13** READMEs, architecture doc, CHANGELOG 0.2.0; tag `v0.2.0-dev.1`.

**D · Shared** (each with commonTest covering loading, success, failed, offline and NotAllowed)
- **D1** All new schemas in `apiModels`, including `PatientMix`, `KeyCount`, `PatientBreakdown`, `TodayMoney` and the visit, note, procedure and plan schemas; generated code compiles (`allOf`).
- **D2** `Preferences` and `Dictation` interfaces, fakes, `AppGraph` and `IosApp` wiring.
- **D3** `NavModel`: tabs and tiles per role and multi-clinic; tests for all 6 roles.
- **D4** Today "Me" and "My schedule" (membership → team member → practitioner); finance via `/today/money`. **Field map, required; done when no v7 number lacks a source:**

  | v7 number | Source |
  |---|---|
  | visits today, waiting, done | `/today` counts |
  | collected, pending dues | `TodayMoney.collected_paise`, `pending_dues_paise`, `pending_dues_patients` |
  | UPI / Cash / Card split | `TodayMoney.revenue_mix`, `upi_share_bps` |
  | expenses today | `/expenses` for today (finance.view only) |
  | progress ring 14/24 | done / total from `/today` |
  | me-card "N patients for you" and treatments | "My schedule" filtered appointments and their reasons |
  | month target, sterilisation cycles, "ends ~6 pm" | Preview (BK-15, BK-16) |
- **D5** `ScheduleStateHolder`: queue actions (call in, seat, done, left, start visit), day view, week density and slots.
- **D6** Booking: availability and `POST /appointments`; slot chips data.
- **D7** Analytics calls and holder (three periods, Preview flags for the split data). **Field map, required; done when no v7 number lacks a source:**

  | v7 number | Source |
  |---|---|
  | Patient visits (labelled "patient visits", not unique patients) | Σ `buckets[].patients.new + returning`; deltas compare the same number of buckets |
  | New patients | Σ `patients.new` |
  | Revenue | Σ `income_paise` (only if `money_visible`) |
  | Expenses total and rows | Σ `expenses_paise`; `buckets[].expenses` by category |
  | Avg chair time | Σ `booked_minutes` / Σ `appointments` from `chair_utilization` |
  | Chair-time gauge | booked vs open minutes; the Treatment/Consults/Admin split is Preview (BK-4) |
  | Booked / Walk-in split | Preview (BK-19) |
  | Deltas (+13%) | current period vs the previous one in the same response (extend the range by one period) |
  | Bars | per bucket |
  | Heat map | `busy_hours` |
  | Treatment-mix radar | `visit_kinds` axes new / follow_up / procedure / emergency (real); procedure categories Preview (BK-4) |
  | Men / women / children | age bands real; sex split Preview |
- **D8a** Split `ChartStateHolder.kt` (430 lines) into a history/terms reducer and a recording part, each under 300 lines. The existing tests stay green and the public API is unchanged.
- **D8** Procedure → finding map, `ToothSheetStateHolder`, `record(visitId)`, Edit (after B1 and D8a).
- **D9a** Split `RxSheetStateHolder.kt` (445 lines) into a lines/drug-search reducer and an allergy-check/issue part, each under 300 lines. The existing tests stay green.
- **D9** Visit start (queue or direct), `VisitStateHolder`, notes create/PATCH/sign, procedures, close, `RxSheetStateHolder.visitId` (after D9a). Rx delivery:
  - WhatsApp via `wa.me` (real).
  - SMS via an `sms:` intent / URL (real).
  - Print opens the web print route in the in-app browser if S0.2 confirms it; otherwise Preview (matches the deviations row).
  - The masked phone number comes from the patient's contact (shown only with patients.contact).
- **D10** Expenses (validation, no automatic retry).
- **D11** Registration; invite parse and accept (token kept in memory); clinic switch reload.
- **D12** Staff list and stock low; `LabsRepository`, `ChatRepository`, notifications and messages Preview holders.
- **D13** Product art and icons as path data in shared (the v7 icon map, avatars, illustrations, jaw geometry), with parse tests.
- **D14** `AttachmentsRepository`, built on the existing `uploadAttachment` / `POST /patients/{id}/attachments` with labels Old Rx / X-ray / Report and the existing `PhotoPrep`, plus a camera/picker adapter injected into `AppGraph`, with fakes. Used by the Patient 360 Photo action, the walk-in "Photo of old Rx / X-ray" button, and the avatar sheet's "Take a photo / Choose photo". The avatar photo is stored on the device only; server storage is BK-10.
- **D15** Queue summary: compute avg wait and no-shows from the `/queue` and `/today` data already loaded. Anything that can't be computed is Preview (BK-17).

**A · Android.** Each task: spec-matched, strings in en/hi/mr, content descriptions, Robolectric qualifiers `w320dp`/`w600dp`/`w840dp`, an API budget, and parity sheets at 320/360/411 dp, tablet, fontScale 1.3, light and dark.
- **A1** Shell: floating bar from `NavModel`, rail when wide, tab fade-through, push shared axis, tab bar hide and return, shared avatar flight. Remove `MoreMenu`.
- **A2** Walk-in sheet in v7 style (from the FAB with container transform), Back fixed with a discard confirm; the "Photo of old Rx / X-ray" button uses D14 after the walk-in is created.
- **A3** Today (a): me-card pager with dots and avatar edit; dark "My schedule" with the week strip.
- **A4** Today (b): stat group, hero (ring, live dot, Open record / Call in), money cards (owner or finance), sparkline.
- **A5** Today (c): Up-next carousel, schedule list, Needs attention, QR sheet, notifications sheet (Preview); the finance Today variant.
- **A6** Schedule Queue: chair board with mini-rings, Seat next (real seat; chair choice Preview, BK-14), tickets with timers, Call in, summary chips (D15).
- **A7** Schedule Day (chair columns, now-line, day strip) and Week (heat map, open-slot chips to the booking sheet); booking sheet with slot and chair chips.
- **A8** Patients list (search, filter chips, shaped avatars, due pills).
- **A9** Patient 360 (a): tonal header, flags, quick actions (Call via `tel:`, WhatsApp via `wa.me`, Book via the D6 sheet, Photo via D14), pill tabs with swap animation, role-hidden tabs.
- **A10** Patient 360 (b): Visits, Rx and Bills tabs (real bills; recording a payment uses `POST /payments`; Collect by UPI is Preview, BK-13; the locked Bills state for assistants), Send Rx and Share buttons, the share sheet (Rx real, the rest Preview).
- **A11** Tooth sheet: history list and Edit (after D8).
- **A12** Add treatment form: restyled `RecordFindingSheet` matching the founder's screenshot.
- **A13** 2.5D vector jaw (the fallback for J): geometry from D13, tilt, spring lift, toggle, reduced motion.
- **A14** Start treatment and the Visit screen: header, timer, quick picks, procedures, close.
- **A15** Dictation: permissions, language chips, live partial text, bullets.
- **A16** Rx sheet restyle: allergy swap card, delivery chips (WhatsApp / SMS real; Print per D9), masked number, "Sent" result with the check-mark draw, visit link.
- **A17** More page, avatar picker sheet (illustrated avatars plus photo via D14), Switch clinic picker, Language sheet, Help (email and WhatsApp support real, chat Preview), Settings link.
- **A18** Analytics: all charts and the period switch.
- **A19** Expenses list and keypad sheet.
- **A20** Welcome pager with illustrations, blobs and dots; the "Opening clinic" screen.
- **A21** Sign-in (code boxes with autofill), registration, invite (WhatsApp-style preview bubble, Join screen, deep link, paste link) after B2; SMS and SSO shown as Preview.
- **A22** Labs: directory, cases, WhatsApp, Preview.
- **A23** Team list (real) and team chat (Preview).
- **A24** Robolectric UI tests across tasks: tabs per role, More gating, forms, widths.

**I · iOS** (each lands right after the matching A task)
| Task | Scope | Done when |
|---|---|---|
| I1 | Shell: `TabView` with tabs from `NavModel`; `.tabBarMinimizeBehavior(.onScrollDown)` on 26 | XCTest on tab mapping; parity sheets at SE and Pro Max, Dynamic Type xxxLarge, light and dark |
| I2 | Walk-in sheet (`.presentationDetents`) with the D14 photo (`PhotosPicker` / camera) | XCTest; parity |
| I3 | Today me-card pager and My schedule | XCTest; parity |
| I4 | Today stats, hero, money cards | XCTest; parity |
| I5 | Today lists, QR and notifications sheets, finance variant | XCTest; parity |
| I6 | Schedule Queue | XCTest; parity |
| I7 | Schedule Day and Week, booking sheet | XCTest; parity |
| I8 | Patients list | XCTest; parity |
| I9 | Patient 360 header, quick actions (`tel:`, `wa.me`, Book, Photo via D14), pill tabs | XCTest; parity |
| I10 | Patient 360 tabs (payments real, UPI collect Preview) and share sheet | XCTest; parity |
| I11 | Tooth sheet history and Edit | XCTest; parity |
| I12 | Add treatment form (restyled `ChartTab` record sheet) | XCTest; parity |
| I13 | 2.5D vector jaw, the fallback for J (`rotation3DEffect`) | XCTest; parity |
| I14 | Visit screen | XCTest; parity |
| I15 | Dictation (`SFSpeechRecognizer`, usage strings) | XCTest; parity |
| I16 | Rx sheet restyle (WhatsApp / SMS real, Print per D9) | XCTest; parity |
| I17 | More, avatar picker (with photo via D14), Switch clinic, Language, Help, Settings | XCTest; parity |
| I18 | Analytics | XCTest; parity |
| I19 | Expenses | XCTest; parity |
| I20 | Welcome and "Opening clinic" | XCTest; parity |
| I21 | Sign-in (`.oneTimeCode`), registration, invite (URL scheme handled in `RootView` / `AppModel`) | XCTest; parity |
| I22 | Labs Preview | XCTest; parity |
| I23 | Team and chat | XCTest; parity |

**J · True 3D jaw** (founder decision; the Pro feature). The 2.5D vector jaw from A13/I13 becomes the **fallback**: for low-end GPUs, when the 3D asset fails to load, and as a light "overview" mode.
- **J1 · Asset spec and sourcing.** This blocks the shipping visuals, not the code. Write `docs/mockups/jaw-3d-asset-spec.md`:
  - glTF 2.0 (`.glb`) for Android, plus USDZ for iOS.
  - Each tooth is a separate mesh named by FDI number: `T11`–`T48` for adults, `T51`–`T85` for primary teeth (or a second child model).
  - Gums are separate upper and lower meshes.
  - The bite opens slightly.
  - PBR enamel, dentin and gum materials.
  - ≤ 60k triangles in total. Size caps:
    - glb ≤ 3 MB, using Draco or meshopt mesh compression (both supported by gltfio).
    - USDZ ≤ 5 MB, using texture compression only (USDZ has no mesh compression).
  - A licence that allows use in a commercial app, with no attribution shown in the app or with attribution in About.
  - Shortlist 3–5 candidates (commercially licensed stores, or a commission brief with a cost estimate). **The founder picks and buys or approves; I never buy anything.**
  - Conversion pipeline from glb to USDZ (Reality Converter / `usdzconvert`), documented.
  - **Dev stand-in:** until the asset arrives, a simple model generated by a script (rounded capsules placed on the v7 jaw geometry, named by FDI number). It is dev-only, never shipped, and marked as such in the build.
- **J2 · Android renderer:**
  - SceneView (`io.github.sceneview`, Apache-2.0, built on Filament) in a Compose wrapper `Jaw3D`, or Filament + gltfio directly if SceneView doesn't fit the BOM. Decided in the S0.1 dependency check, with the reason in the catalog commit.
  - Behaviour:
    - orbit limited to ±35° yaw and ±20° pitch, and pinch zoom
    - double-tap resets the view
    - tap hit-tests the tooth node, which opens the tooth sheet
    - status materials from the K2 chart and status tokens (treated, in progress, planned, watch, missing hidden or ghosted)
  - `Jaw3D` lives in the **app modules**, not the kit (product art, kit rule 1); the new dependency is justified in the commit body (kit AGENTS rule 4).
    - the selected tooth lifts and glows with a spring
    - Upper / Lower / Both toggle, and Adult / Child
  - Respects reduced motion (no idle spin). Each tooth node gets an accessibility label, and there's a list alternative for TalkBack.
  - Lifecycle-safe (`Engine` disposed).
  - Tests: Robolectric for the state mapping; a manual GPU check on a low-end emulator profile (e.g. API 26, 2 GB).
  - Done when tap → sheet works on the stand-in and the asset, the APK size increase is reported, and the frame time at idle and while orbiting is measured.
- **J3 · iOS renderer:**
  - RealityKit `ARView(cameraMode: .nonAR)` on iOS 17, and `RealityView` on 18+ if it offers more. Loads USDZ.
  - The same gestures, materials, selection and toggles as J2; VoiceOver list alternative.
  - **Hit-testing:** every tooth gets collision shapes (`generateCollisionShapes`). ARView uses `entity(at:)`; RealityView uses an `InputTargetComponent` with a targeted `SpatialTapGesture`.
  - XCTest for the mapping.
  - Done when it matches J2 on the simulator and the size increase is reported.
- **J4 · Fallback logic** (shared and both apps): use 3D only if the asset loaded and the device passes the capability check (Android OpenGL ES 3.0 / Vulkan available and RAM ≥ 3 GB; iOS any Metal device). Otherwise use the 2.5D vector jaw. A user toggle in the chart lets them switch. Tests for the decision function.
- **J5 · Parity and quality pass:** contact sheets of the 3D jaw in light and dark at 3 sizes, with the founder signing off the look (lighting, materials, camera framing). Performance numbers go in the handoff.

**V · Verification**
- **V1** Parity contact sheets for every sheet ID: both platforms, all sizes, light and dark. Fix the differences or add them to the deviations table.
- **V2** Live-data sweep for owner, doctor, consultant, front desk, assistant, finance and Dev at two clinics. End-to-end: register → console approve → invite email (local outbox) → app join → Today; walk-in → queue → start visit → record → dictate → Rx → close.
- **V3** Large text and reduced motion on each platform.
- **V4** Docs: architecture, decisions, mockup check, backlog, handoff. Report to the founder with the side-by-side screenshots.

**Order and estimate:**
- S0 → B1/B2 → K → D → (A*n* followed by I*n*) → V.
- Session 1: S0, B1, B2, K, D1–D6.
- Session 2: D7–D15 (including D8a and D9a), A1–A10 with I1–I10.
- Session 3: A11–A24 with I11–I23, then J1 (spec and shortlist early, so the founder can buy the asset in parallel).
- Session 4 (likely): J2–J5 and V.

The 3D jaw adds about one session and depends on the founder's asset purchase. Everything else doesn't wait on it: the vector fallback ships first.

Progress is reported per task; nothing is cut silently.

## Risks
- **In-house Expressive components** mean more code to maintain.
- **Marathi on-device speech** may be missing; the fallback is network recognition behind a notice and a setting.
- **The iOS 17–25 fallback** is unverified.
- **The kit release order** belongs to the founder.
- **The patient app** is affected by the token and type changes: build and check it (in K2/K3).
- **`material3-adaptive`** may be incompatible; the fallback is ready.
- **3D jaw:**
  - It depends on a licensed asset the founder must buy or commission (J1). SceneKit and RealityKit choices are made on iOS 17 support; SceneKit is avoided because it's deprecated.
  - It adds several MB to each app (measured and reported).
  - On low-end phones it falls back to the vector jaw (J4).
- **Art quality:** illustrations and avatars are refined vector art drawn in code (the founder's choice): more layers, highlights and shading than the mockup, while keeping its shapes and colours. They're checked in the parity sheets.
