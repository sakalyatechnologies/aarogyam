# Mobile v7 task tracker

The plan is in `mobile-v7-plan.md` (approved 9 Oct 2026 after 6 independent reviews). The spec is in `../mockups/mobile-v7-spec.md`.

Tick a task only when its done criteria pass: tests, gates and parity sheet. Add the commit hash.

| Task | Status | Commit | Summary |
|---|---|---|---|
| S0.1 | done |  | Worktrees, symlink, `mobile-deps.sh`; baseline gates green. Dependency checks, results recorded: |
| S0.2 | done |  | Copy the mockup to `docs/mockups/mobile-v7.html`. Write `mobile-v7-spec.md` covering: |
| S0.3 | done |  | Reference-render script: v7 renders for each sheet ID at 320/360/390/430 widths, light and dark. Done when renders exist for every ID. |
| S0.4 | done |  | Copy the tracker into the repo. Add backlog items: |
| B1 | todo |  | `NewChartEntry.supersedes_id` for surface-change edits in `aarogyam-app/src/chart.rs`. `cargo test`, openapi regeneration and regenerated mo |
| B2 | todo |  | Web `invite-page.tsx`: "Open in the Aarogyam app" plus a test. Before A21. |
| K1 | todo |  | `ColorMath` HSL helpers and tests. |
| K2 | todo |  | v7 tokens in `AppTheme` (including chart, status and the fixed mockup colours as tokens); tests for the count and AA across 6 presets × 2 mo |
| K3 | todo |  | Type scale (13 styles) and tests; Roboto Flex; SakalyaUI font bundle and registration. |
| K4 | todo |  | Motion tokens (durations, easing, springs, 60 ms stagger), `skPressable`, reduced motion. |
| K5 | todo |  | Generic path-command model, parser tests, and Compose/SwiftUI renderers. |
| K6 | todo |  | `SkAvatar` (slot and shape), `RoundedPolygon` cookie and blob morph, live pulse dot, badge dot, draw-on check mark, spinning shape, and the  |
| K7 | todo |  | `SkSegmented` (with swap animation), `SkChoiceChips`, `SkKeypad`. |
| K8 | todo |  | `SkStatGroup`, `SkTicket`, `SkLoadingIndicator`, `SkToast` (icon, message, spring). |
| K9 | todo |  | Chart geometry (pure, tested), `SkBarChart` (ghost tracks, grow-in, tooltip, selection), `SkSplitBar` (grow-in), `SkSparkline`. |
| K10 | todo |  | `SkGauge` (segmented arc sweep), `SkProgressRing` (fill on entry), `SkAreaChart` (gradient, line draw), `SkRadarChart` (pop-in), `SkHeatmap` |
| K11 | todo |  | `SkFloatingNavBar` (active pill stretch, trailing action, hide on scroll) and `SkCollapsingTopBar` (large to inline past 34 px), as document |
| K12 | todo |  | Motion and feedback kit: |
| K13 | todo |  | READMEs, architecture doc, CHANGELOG 0.2.0; tag `v0.2.0-dev.1`. |
| D1 | todo |  | All new schemas in `apiModels`, including `PatientMix`, `KeyCount`, `PatientBreakdown`, `TodayMoney` and the visit, note, procedure and plan |
| D2 | todo |  | `Preferences` and `Dictation` interfaces, fakes, `AppGraph` and `IosApp` wiring. |
| D3 | todo |  | `NavModel`: tabs and tiles per role and multi-clinic; tests for all 6 roles. |
| D4 | todo |  | Today "Me" and "My schedule" (membership → team member → practitioner); finance via `/today/money`. Field map, required; done when no v7 num |
| D5 | todo |  | `ScheduleStateHolder`: queue actions (call in, seat, done, left, start visit), day view, week density and slots. |
| D6 | todo |  | Booking: availability and `POST /appointments`; slot chips data. |
| D7 | todo |  | Analytics calls and holder (three periods, Preview flags for the split data). Field map, required; done when no v7 number lacks a source: |
| D8 | todo |  | Procedure → finding map, `ToothSheetStateHolder`, `record(visitId)`, Edit (after B1 and D8a). |
| D8a | todo |  | Split `ChartStateHolder.kt` (430 lines) into a history/terms reducer and a recording part, each under 300 lines. The existing tests stay gre |
| D9 | todo |  | Visit start (queue or direct), `VisitStateHolder`, notes create/PATCH/sign, procedures, close, `RxSheetStateHolder.visitId` (after D9a). Rx  |
| D9a | todo |  | Split `RxSheetStateHolder.kt` (445 lines) into a lines/drug-search reducer and an allergy-check/issue part, each under 300 lines. The existi |
| D10 | todo |  | Expenses (validation, no automatic retry). |
| D11 | todo |  | Registration; invite parse and accept (token kept in memory); clinic switch reload. |
| D12 | todo |  | Staff list and stock low; `LabsRepository`, `ChatRepository`, notifications and messages Preview holders. |
| D13 | todo |  | Product art and icons as path data in shared (the v7 icon map, avatars, illustrations, jaw geometry), with parse tests. |
| D14 | todo |  | `AttachmentsRepository`, built on the existing `uploadAttachment` / `POST /patients/{id}/attachments` with labels Old Rx / X-ray / Report an |
| D15 | todo |  | Queue summary: compute avg wait and no-shows from the `/queue` and `/today` data already loaded. Anything that can't be computed is Preview  |
| A1 | todo |  | Shell: floating bar from `NavModel`, rail when wide, tab fade-through, push shared axis, tab bar hide and return, shared avatar flight. Remo |
| A2 | todo |  | Walk-in sheet in v7 style (from the FAB with container transform), Back fixed with a discard confirm; the "Photo of old Rx / X-ray" button u |
| A3 | todo |  | Today (a): me-card pager with dots and avatar edit; dark "My schedule" with the week strip. |
| A4 | todo |  | Today (b): stat group, hero (ring, live dot, Open record / Call in), money cards (owner or finance), sparkline. |
| A5 | todo |  | Today (c): Up-next carousel, schedule list, Needs attention, QR sheet, notifications sheet (Preview); the finance Today variant. |
| A6 | todo |  | Schedule Queue: chair board with mini-rings, Seat next (real seat; chair choice Preview, BK-14), tickets with timers, Call in, summary chips |
| A7 | todo |  | Schedule Day (chair columns, now-line, day strip) and Week (heat map, open-slot chips to the booking sheet); booking sheet with slot and cha |
| A8 | todo |  | Patients list (search, filter chips, shaped avatars, due pills). |
| A9 | todo |  | Patient 360 (a): tonal header, flags, quick actions (Call via `tel:`, WhatsApp via `wa.me`, Book via the D6 sheet, Photo via D14), pill tabs |
| A10 | todo |  | Patient 360 (b): Visits, Rx and Bills tabs (real bills; recording a payment uses `POST /payments`; Collect by UPI is Preview, BK-13; the loc |
| A11 | todo |  | Tooth sheet: history list and Edit (after D8). |
| A12 | todo |  | Add treatment form: restyled `RecordFindingSheet` matching the founder's screenshot. |
| A13 | todo |  | 2.5D vector jaw (the fallback for J): geometry from D13, tilt, spring lift, toggle, reduced motion. |
| A14 | todo |  | Start treatment and the Visit screen: header, timer, quick picks, procedures, close. |
| A15 | todo |  | Dictation: permissions, language chips, live partial text, bullets. |
| A16 | todo |  | Rx sheet restyle: allergy swap card, delivery chips (WhatsApp / SMS real; Print per D9), masked number, "Sent" result with the check-mark dr |
| A17 | todo |  | More page, avatar picker sheet (illustrated avatars plus photo via D14), Switch clinic picker, Language sheet, Help (email and WhatsApp supp |
| A18 | todo |  | Analytics: all charts and the period switch. |
| A19 | todo |  | Expenses list and keypad sheet. |
| A20 | todo |  | Welcome pager with illustrations, blobs and dots; the "Opening clinic" screen. |
| A21 | todo |  | Sign-in (code boxes with autofill), registration, invite (WhatsApp-style preview bubble, Join screen, deep link, paste link) after B2; SMS a |
| A22 | todo |  | Labs: directory, cases, WhatsApp, Preview. |
| A23 | todo |  | Team list (real) and team chat (Preview). |
| A24 | todo |  | Robolectric UI tests across tasks: tabs per role, More gating, forms, widths. |
| I1 | todo |  | Shell: `TabView` with tabs from `NavModel`; `.tabBarMinimizeBehavior(.onScrollDown)` on 26 |
| I2 | todo |  | Walk-in sheet (`.presentationDetents`) with the D14 photo (`PhotosPicker` / camera) |
| I3 | todo |  | Today me-card pager and My schedule |
| I4 | todo |  | Today stats, hero, money cards |
| I5 | todo |  | Today lists, QR and notifications sheets, finance variant |
| I6 | todo |  | Schedule Queue |
| I7 | todo |  | Schedule Day and Week, booking sheet |
| I8 | todo |  | Patients list |
| I9 | todo |  | Patient 360 header, quick actions (`tel:`, `wa.me`, Book, Photo via D14), pill tabs |
| I10 | todo |  | Patient 360 tabs (payments real, UPI collect Preview) and share sheet |
| I11 | todo |  | Tooth sheet history and Edit |
| I12 | todo |  | Add treatment form (restyled `ChartTab` record sheet) |
| I13 | todo |  | 2.5D vector jaw, the fallback for J (`rotation3DEffect`) |
| I14 | todo |  | Visit screen |
| I15 | todo |  | Dictation (`SFSpeechRecognizer`, usage strings) |
| I16 | todo |  | Rx sheet restyle (WhatsApp / SMS real, Print per D9) |
| I17 | todo |  | More, avatar picker (with photo via D14), Switch clinic, Language, Help, Settings |
| I18 | todo |  | Analytics |
| I19 | todo |  | Expenses |
| I20 | todo |  | Welcome and "Opening clinic" |
| I21 | todo |  | Sign-in (`.oneTimeCode`), registration, invite (URL scheme handled in `RootView` / `AppModel`) |
| I22 | todo |  | Labs Preview |
| I23 | todo |  | Team and chat |
| J1 | todo |  | Asset spec and sourcing. |
| J2 | todo |  | Android renderer: |
| J3 | todo |  | iOS renderer: |
| J4 | todo |  | Fallback logic |
| J5 | todo |  | Parity and quality pass: |
| V1 | todo |  | Parity contact sheets for every sheet ID: both platforms, all sizes, light and dark. Fix the differences or add them to the deviations table |
| V2 | todo |  | Live-data sweep for owner, doctor, consultant, front desk, assistant, finance and Dev at two clinics. End-to-end: register → console approve |
| V3 | todo |  | Large text and reduced motion on each platform. |
| V4 | todo |  | Docs: architecture, decisions, mockup check, backlog, handoff. Report to the founder with the side-by-side screenshots. |
