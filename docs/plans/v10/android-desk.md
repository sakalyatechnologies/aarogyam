# T13 desk: Android port of the front desk (15 Nov 2026)

Branch `v11-and-desk`. Files: `mobile/androidApp/src/main/kotlin/com/aarogyam/staff/android/ui/desk/**`, `res/values*/strings_desk.xml` (generated from the iOS DeskV9, DeskV10 and IntakeV10 tables; keys are `dk_<ios key with _>`), test `androidApp/src/test/.../desk/DeskLogicTest.kt`.

## Written
- Desk home `DeskHome(graph, clinic, nav)`: strip, finder with profile chips and Check in · Dr X, board, Unpaid from earlier days, Missed today, Relatives sheet, pull to refresh. iOS: DeskHomeScreen, DeskEarlierSections.
- Board `DeskBoard.kt` (welcome note line, wait timer, Remind with `RemindAnswer.quietSeconds` via `DeskFeed.remind`, Send in, called banner, Collect) and `DeskBoardScreen`. iOS: DeskBoardScreen.
- Lookup `DeskLookupScreen` + `DeskFinder.kt` (profile row). iOS: DeskLookupScreen, DeskSheet.
- Family: `DeskFamily.kt` (relatives list, link existing). iOS: DeskSheet family part.
- Intake `IntakeScreen.kt`, `IntakeSignature.kt` (Canvas to PNG), `DeskPhoto.kt`. iOS: IntakeV10/*.
- Payment `DeskPaymentSheet.kt` (UPI, cash, card, proof photo, offline saved). iOS: DeskPaymentSheet.
- Live data `DeskFeed.kt` (iOS DeskV10Feed: one /today, /queue, /notifications per refresh).

## Openers (DeskRoutes.kt)
`openDeskIntake(phone)`, `openDeskIntake(phone, family)`, `openDeskPayment(tokenId, invoiceId)`, `openDeskLookup()`, `openDeskBoard()`; `DeskHome(graph, clinic, nav)`. Also public `DeskAlertRow` logic in `DeskAlert` (DeskLogic.kt) for the shell's notifications sheet.

## Left / gaps
- UPI QR: iOS has none and the catalog has no QR library; not done.
- No `DeskAlertRow` composable yet (shell owns the sheet); logic is in `DeskAlert`.
- Visual checks by the coordinator.

## Needs from other areas
- Shell: show `DeskHome` for the desk role; call `openDeskLookup()` for Walk-in and `openDeskBoard()` from Schedule.

## Status
Compile, spotless, lint and unit tests pass (build-lock). Not run on a device.
