# v9 History tab (branch v9-history)

## Done
- `ClinicApi.visit(id)` (`GET /visits/{id}`); `VisitDetail` and `Observation` added to apiModels.
- `VisitHistoryStateHolder(clinic, patientId, scope)`: rows newest first (date, clinician, title,
  hasRx, bill Paid/Due/None, open). hasNotes and hasPhotos are null (the list calls lack them).
  3 requests: visits, prescriptions (needs clinical.read), invoices (needs billing.read); joined by encounter_id.
- `VisitDetailStateHolder(clinic, visitId, patientId, scope)`: procedures (tooth, fee), notes by S/O/A/P,
  Rx items, files, bill (total/paid/balance), `moneyVisible`. 3 requests; money hidden without billing.read.
- States: Loading, NotAllowed, Failed(ScreenError), Loaded(refreshing, error). No user-facing text.

## Public API (iOS)
- `graph.visitHistory(clinic, patientId, scope)` -> `state: VisitHistoryState`, `refresh()`
- `graph.visitDetail(clinic, visitId, patientId, scope)` -> `state: VisitDetailState`, `refresh()`

## Files
mobile/shared/build.gradle.kts, api/VisitCalls.kt, AppGraph.kt, history/{HistoryJoins,VisitHistoryStateHolder,
VisitDetailModels,VisitDetailStateHolder}.kt, commonTest/history/{VisitHistory,VisitDetail}StateHolderTest.kt

## Tests
`./gradlew :shared:jvmTest --tests '*VisitHistoryStateHolderTest*' --tests '*VisitDetailStateHolderTest*'`: BUILD SUCCESSFUL.
Covers newest-first, encounter_id join (missing Rx and bill, void bill, cancelled Rx), NotAllowed, offline, not found, assistant money hidden.
Full `./gradlew check` (spotless, lint) not run.

## Left
- Run `./gradlew check`; fix any lint.
- iOS: build History tab and visit sheet over these holders; the list can show notes/photo chips only after opening the detail.
- Optional backend: counts on the visit list so hasNotes/hasPhotos can be filled.
