# Mobile v7 · iOS progress (branch feat/mobile-v7-ios)

Kept by the iOS worker; the main tracker (`mobile-v7-tasks.md`) is ticked on merge.

| Task | Commit | Notes |
|---|---|---|
| I1 | 070c9ff | Shell: system TabView with NavModel tabs and v7 icons (template images from the art catalogue), glass toolbar bar action (walk-in / add expense), `tabBarMinimizeBehavior(.onScrollDown)` on iOS 26. Schedule tab = Queue / Day / Week (new heat map). More page (profile row, tile grid, list), stock page, avatar picker with on-device photo. `ArtView` draws the shared art catalogue (gradients in box units, theme roles, nested loops). v7 roles come from the clinic brand. |
| I2 | (this commit) | Walk-in in the v7 sheet (kit `skSheet`, `SkField`, `SkPillButton`): mobile, matches as rows, name, age and sex chips, allergy chips, doctor chips, consent toggle, warm "Add to queue"; done state with the check mark drawing on. Kit pinned to v0.2.0-dev.2. Local-only launch hooks (`AAROGYAM_DEV_SIGN_IN`, `_TAB`, `_SHEET`) for screenshots. |
| I3-I5 | 1039713 | v7 Today on iOS (`Screens/TodayV7/`, entry `RoutesA.today`): me card + My schedule pager with dots and week strip, stats group, hero with progress ring, money cards, Up next carousel, schedule, Needs attention, Clinic QR sheet (CoreImage QR of `<clinic origin>/book`, copy and share), notifications sheet (read all, unread dot on the bell), finance-only variant (UPI split, month revenue mix). Strings in `TodayV7.xcstrings` (en/hi/mr). Old `TodayScreen` removed. |
| I6-I7 | f125683 | Schedule on iOS (`Screens/ScheduleV7/`): Queue with the chair board (in-chair cards from tokens, free chairs from the clinic's chair list, "Seat next" seats the longest-waiting token through the queue status), `SkTicket` tickets with wait timers that count on from the server's reading, Start visit or Seat, summary chips from shared `QueueSummary`; Day with a week strip, doctors/chairs columns down the hours, overlapping lanes and the now line; Week heat map in a card with the busiest hour; booking sheet (patient search, then shared `BookingStateHolder`: doctor, day, kind, chair, free slots, reason, warnings) behind the calendar button. |
| I20-I21 | (this commit) | Signed-out flow (`Screens/Auth/`, entry `RoutesA.signedOut`): welcome pager (tooth, family, implant from `IllustrationArt` through `ArtView`, morphing blobs, floating orbs, dots, Get started and I have a clinic invite); sign-in with the lock blob, email field and the 8-box code (hidden `.oneTimeCode` field, auto-submits when full); registration form on `RegistrationStateHolder` (inline field errors, received state); invite on `InviteStateHolder` (paste or `aarogyam://invite#token` through `.onOpenURL` -> `AppModel.pendingInvite`, sign in, then Join and the clinic list). "Opening <clinic>" spinner screen covers the clinic picker while a clinic opens. Registered the `aarogyam` URL scheme in `project.yml`. |

## Deviations
- Tab bar icons are the v7 line icons rendered to template images; the selected state is the system's (per plan: iOS keeps the system TabView).
- Tiles whose page is not built yet open the "Preview" page until their task lands.

- Today: no sparkline, no "Call in", no month target and no dues/recent-expense lists for finance (no server data): finance shows a Preview notice where the mock-up has them. The Add expense card calls MainTabs' `addExpense` flag; the sheet itself is another task.

- Queue: chair choice, "Call in" and no-shows are previews (no server data); in-chair cards are not tied to a named chair (a token has no room). Week: "open slots worth filling" is a preview. Day/Week open from `ScheduleTab`, which now takes `onWalkIn`.

- Sign-in is by emailed code (8 digits) as the server does it: the mock-up's mobile number, Apple and Google buttons are shown as a Preview notice. The Opening screen shows the role, not the person's name (the picker has none).

## Shared changes requested
- `WalkInState.Done.patientId`: the "Photo of old Rx / X-ray" button after a walk-in needs the patient to upload to (D14); hidden until then.
- `ClinicBranding.roleTokens(systemDark)` in iosMain: Palette colours reach Swift boxed, so iOS reads the hex from their description (works, but fragile).
