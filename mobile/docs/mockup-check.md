# Mock-up check (2026-10-06)

The staff app run against a local stack with seeded synthetic data (Sunrise Dental), compared with `docs/mockups/mobile.html`. Screenshots: `docs/screenshots/android/` (Pixel 9a emulator) and `docs/screenshots/ios/` (iPhone 18 Pro, iOS 27 simulator); numbering follows the screens: 01 sign-in, 02 Today, 03 Patients, 04 Calendar, 05 Patient 360 Overview, 06 Chart, 07 Rx, 08 Billing, 09 Rx sheet (09d the allergy alert), 10 Share sheet. The mock-up is script-driven, so it was compared on its first paint (Today, both platforms) and by reading its source for the other screens.

How to reproduce: README, "Run against the local stack".

## Fixed in this change

| # | Where | Difference | Fix |
|---|---|---|---|
| 1 | Android, every screen with the brand header | The status bar clock and icons were dark on the dark green header (the mock-up has light ones) | Light status bar icons app-wide; the sign-in screen, which has no header, follows the theme |
| 2 | Android Billing tab | The "Bills" heading sat alone in an empty card above the bill cards | The heading is plain text above the cards |
| 3 | iOS Share sheet | The issued-prescription sheet filled the screen with a short PIN panel at the top (the mock-up and Android use a bottom sheet of content height) | Medium detent once issued; composing stays large |
| 4 | Both | After recording a payment, Patient 360's Overview kept the old balance | Patient 360 reloads when a payment is recorded (gap a) |
| 5 | Both | An allergy stop on issuing showed a generic "the clinic's check flagged this" | The sheet lists the server's alerts, for example "AMOXICILLIN may cause a reaction: recorded allergy to Penicillin" (gap b) |

## Open differences (not fixed)

Missing elements that need a product decision or a feature, not a spacing or colour fix:

1. **Today, "Needs attention"** (allergy flags, overdue recalls): the mock-up lists them under the schedule; the app has no section. The seed has none to show either.
2. **Today, hero actions**: the mock-up's "Up next" card has Start visit and Message buttons; the app's card is read-only. The app also says "In the chair" for the current patient where the mock-up says "Up next".
3. **Android Today**: the mock-up's app bar has notification and settings icons and a "Good morning, Dr. ..." line with the clinic; the app shows Switch clinic and Sign out as text actions.
4. **Android floating "+" button** (book, walk-in, new patient) on Today and Calendar: absent. Booking is not in this app yet.
5. **Calendar**: the mock-up has a week strip (days across, tap a day); the app has a single date with previous/next arrows and a Doctors/Chairs switch. The mock-up has no chairs view.
6. **Patient 360 header**: the mock-up has a hero with a large avatar, the file number, and allergy and condition chips right under the name. The app shows the name and "SD-1 . Age 36 . Female" in the header and the flags in the first card of Overview (Android has no avatar in the header; iOS shows it beside the contact line).
7. **Patients list**: the mock-up's search has a microphone (voice search) chip; the app has none.
8. **Chart**: the mock-up has an Imaging card (OPG, IOPA, bitewing viewer) under the chart; the app has none (no imaging API yet). Its tooth detail panel lists treatments per tooth; the app's panel opens from a tap.
9. **Patient 360 tabs**: the mock-up's tabs are Chart, Visits, Rx and Bills (the Visits tab is a timeline); the app has Overview, Chart, Rx and Billing, with recent visits inside Overview.
10. **Chips are upper case on Android** (`NO-SHOW`, `DR ASHA KULKARNI (3)`) and sentence case on iOS (`Severe`, `Part paid`); the mock-up uses upper case for status pills only. It comes from the shared chip component.
11. **Dark mode** was not walked (the emulator and simulator ran in light mode).

## Questions for the founder

- Is "Up next" (the next waiting or booked patient) or "In the chair" the hero of Today? Today it is whoever is in the chair, else nothing.
- Should Calendar get the week strip, and a Chairs view, which the mock-up lacks?
- Do you want the allergy and condition chips in the Patient 360 header (as in the mock-up), at the cost of header height?
- Chip case: upper case everywhere, or sentence case on Android as on iOS?
- Recording a payment larger than the balance is accepted by the API (it was ₹4,000 against ₹1,000 due); should the form cap the amount at the balance, or is an advance payment a real case?

## Environment notes

- The local stack: Postgres `aarogyam_dev_qa`, `cargo run -p aarogyam-server -- serve` (config/local.toml), `pnpm dev:portal`; the dev sign-in lists the seeded people and calls `POST /api/v1/dev/token` on `app.localtest.me:5173`.
- Android local debug builds clear `FLAG_SECURE` (synthetic data only) so `adb screencap` works; every other variant still blocks screenshots.
- Dev tokens last one hour and have no refresh token; sign in again afterwards.
