# v10 int: iOS shell wiring and seams

- Rx draft: `RxSheetStateHolder.saveDraftNow()` / `draftId`; Wrap up uses it, no second `RxDraftSync`.
- Audio: `VisitStateHolder.currentNoteId` goes to `enqueueDictationAudio` (ChairModeView); `AppGraph.outboxFiles` is internal and is the one file store.
- `booking_conflict` is a `NotificationKinds` entry; the Swift special case is gone.
- Today tab: Desk home when `TodayV10Logic.usesDesk` (home == Desk), else the v7 Today list. The Desk full-screen cover is gone; the hook is invisible.
- New patient: Desk home `onNewPatient` opens `RoutesV10Intake.screen` as a sheet; done refreshes the desk.
- Doctor: waiting list inline at the top of Today (`RoutesV10Doctor.waitingTop`, max 300pt, collapsible); banner and haptic on arrival.
- My tasks: toolbar button with badge when `tasks.use`; opens the tasks sheet.
- Collect now: `DeskPayTarget.invoiceId` (Wrap up summary, `collect_payment` notification `invoice.id` via `DeskV10Feed.payInvoice`) selects the bill.
- Test: `TodayV10LogicTests` (desk switch, tasks button). Spec said `RoutesV10Desk.opensDesk`; it is `DeskV10Home.opensDesk`.
