# v10 adopt: shared support for four server features

Added (commonMain, no UI). Models allowlisted: MissedList, MissedAppointment, ToCollectList, ToCollectItem, DismissRecall.
- `ClinicApi.dismissRecall(id, reason: String? = null): Outcome<Recall, ApiError>` (RecallCalls.kt)
- `ClinicApi.missedAppointments(date: String? = null): Outcome<MissedList, ApiError>`, `ClinicApi.toCollect(): Outcome<ToCollectList, ApiError>` (FollowUpCalls.kt)
- `RecallsStateHolder.dismiss(id, reason = null)`: removes the row on success, reloads on 409, keeps the row and sets `error` otherwise.
- `ToCollectHolder(clinic, scope)`: `state: StateFlow<ToCollectState>` (Loading, NotAllowed, Failed(error), Loaded(items, totalPaise)), `refresh()`. Needs `payments.collect` or `billing.read`.
- `MissedHolder(clinic, scope)`: `MissedState` (Loading, NotAllowed, Failed(error), Loaded(date, items)), `refresh()`. Needs `appointments.read`.
- iosMain `IosDesk.kt`: `AppGraph.toCollect(clinic, screen)`, `AppGraph.missed(clinic, screen)`.
Tests: RecallsStateHolderTest (dismiss ok, 409, failure), ToCollectHolderTest, MissedHolderTest (loaded, empty, failure+refresh, not allowed).
Not done: `retry_after_seconds` on `remind_too_soon`. The kit's `ApiError` has only code, message, status and requestId (no body or extra fields), and the kit is off limits, so the 60 s hide stays. It needs the kit to expose the error body.
iOS next: SwiftUI screens for To collect and Missed (use the factories, observe `state`), a Dismiss action on the recall row calling `RecallsStateHolder.dismiss`.
