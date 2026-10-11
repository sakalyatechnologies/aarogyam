# v9 outbox3: visit and photo writes survive no network (handoff)

Branch `v9-outbox3` (from bd1600c). Notes, procedures, visit close and photos are saved on the phone and sent when the network is back, never twice.

## Shared (mobile/shared, commonMain/.../outbox/)
- `WriteQueue` (`graph.writes`): `noteCreate`, `noteEdit`, `noteSign`, `procedure`, `close`, `photo`. Returns `Queued.Saved(id)` or `Queued.Refused(FilesFull | QueueFull)`.
- `VisitWriteSender`: the one place that sends them. Registered in `AppGraph` for Note, NoteEdit, NoteSign, Procedure, VisitClose, Photo. Waits (`clinic_not_open`) after a restart until the clinic is open.
- Runner: `OutboxEntry.orderKey` (`visit:<id>`) = strict order across kinds per visit; a refused earlier entry holds later ones; `VisitClose` waits for every other write of its visit, however saved. `coalesceKey` (`note:<id>`): a newer waiting PATCH replaces the older (the one being sent is left alone). New: `ids`, `pendingByKey`, `unsentCount()`, `hasUnsent(key)`.
- `OutboxFiles` (+ `MemoryOutboxFiles`, iOS `ProtectedOutboxFiles`, `NSFileProtectionComplete`): photo bytes beside the queue, deleted when delivered, discarded or at sign-out. Cap 200 MB (`OUTBOX_FILES_MAX_BYTES`): over it the photo is refused (`FilesState.Loaded.queueFull`), nothing older is dropped.
- `AppGraph.trySignOut(): SignOutResult` = `SignedOut` or `SignOutBlocked(pendingCount)` (waiting + refused). `signOut()` is unchanged and forces.

## Holders
- `VisitStateHolder(writes)`: offline or a retryable failure queues the note; once a note went through the queue all its later writes do (the sender owns the row version). `VisitView.noteSync`, `closeSync`, `unsent`; `closed`/`Signed` shown at once.
- `ToothSheetStateHolder(writes)`: `TreatmentFormState.pendingSync`. `FilesStateHolder(writes)`: `Loaded.pendingSync` (count), `queueFull`; gallery reloads when a queued photo lands.

## iOS
`OutboxBadge` in `V9Header` (visit) and `DeskSheet` (top inset). More: sign-out asks "N items not sent yet. Sign out anyway?" (`outbox.signout.*` in Localizable.xcstrings, en/hi).

## Tests (commonTest/outbox/VisitWritesTest.kt, 7)
Order saved, close last; a refused note holds its close; PATCH coalescing; photo resumes after restart then file deleted; size cap; sign-out warning; offline visit end to end (note, PATCH, procedure, sign, close in order, none sent twice after a restart).

## Gaps
- The server has no key for procedures, sign or close. A retried procedure first reads the visit and skips a match (an identical second procedure could be skipped wrongly); sign/close treat 409 on a retry as done. Ask the backend for a client id on procedures.
- Close follow-up uses the existing recall call (no dedupe); `SERVER_CLOSE_BODY` (BE5) is not read by the sender.
- Assumes the server keeps the client note id (the sender also maps a different one for the run).
- Android `OutboxFiles` not built (memory default). No 48 h expiry or background task.
- Patient page photo action is still a Preview toast, so no badge or queue there; `OutboxBadge` not on the Desk board sheet (it has no graph; needs a Routes+V9Desk change).
- Failed (refused) entries have no UI list yet beyond the sign-out count.
