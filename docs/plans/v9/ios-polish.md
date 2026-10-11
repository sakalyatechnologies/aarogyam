# v9 ios-polish: patient page gaps (branch v9-ios-polish, from 235f338)

## Built
- History cards: tooth chips (FDI, from the visit's procedures), "Due ₹X" chip when the bill has a balance (never for a role without `billing.read`), real titles: complaint, else first procedure, else Appointment/Walk-in visit, else "Visit". Visit detail uses the same title.
- Shared (additive, commonTest): `VisitRow.teeth`, `duePaise`, `titleSource` (`VisitTitleSource`, `VisitKind`); `ClinicApi.patientProcedures` (+ `ProcedureList` model); a refused or failed procedures call only drops teeth and titles. `RxSheetStateHolder.shareIssued(id, number)` sends an issued Rx again.
- Photo action (patient header): `V9PhotoSheet` with label chips X-ray, Photo, Old Rx, Report, Camera (`CameraPicker`) or Photos (`PhotosPicker`). Saves through `graph.writes.photo` (outbox3 sender, protected storage); `OutboxBadge` sits under the header while it waits; the Overview reloads when the queue drains.
- Visit detail: "Send prescription" (signed Rx, `prescriptions.issue`) opens `V9SendRxSheet` with `RxDelivery` (WhatsApp, SMS, Print).
- Strings: PatientV9.xcstrings (en, hi, mr).

## Tests
- commonTest: `VisitHistoryPolishTest` (2), `shareIssued` test in RxStateHoldersTest.
- XCTest (PatientV9Tests): title fallback order, due per role, teeth chips.
- `./gradlew spotlessApply check` and `ios-check.sh` (iPhone 18 Pro Max) passed. One run of `VisitDetailStateHolderTest` (Android host) failed once on a request count and passed on rerun; not touched here.

## Gaps
- No screenshots. The Local build here needs `mobile/local.secrets.properties` (shows "This build isn't set up"); a rebuild did not fit the timebox. Dev hooks ready: `AAROGYAM_DEV_SIGN_IN`, `DEV_VISIT` + `DEV_VISIT_STEPS=notes;rx;add:amox;proc;sign;fee;confirm;close`, `DEV_PTAB=history`, `DEV_VISIT_DETAIL=1`, `DEV_PHOTO_SHEET=1` (+ `DEV_DESK_PROOF=1` attaches a sample picture).
- Seed check (API, Asha Kulkarni, Priya Sharma): 14 visits, 11 procedures, 5 Rx, no issued bill on any visit. The Due chip is tested only by XCTest. Close still has no fee body (BE5), so the app cannot create a bill; needs the backend.
- "Visit kind" is derived from `appointment_id` (no kind field on the API).
- Photo action is not gated by `clinical.write`; the server refuses and the outbox drops it. Old Rx and Report upload as kind `photo` (`kindFor`).
- Overview tiles still not openable.
