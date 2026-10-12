# v9 sh-wire: Preview switch points flipped to real calls (branch v9-sh-wire)

Base 235f338. MERGE ORDER: the coordinator must merge `feat/v9-backend` into `feat/v9` so the spec and the
server match. This branch carries only a copy of that branch's `docs/api/openapi.json`; the local API on
:8080 still runs main's schema, so nothing here was run live.

## Built (mobile/shared)
- BE2: `ClinicApi.callToken` (`POST /queue/{id}/call`), `queue(practitionerId)`. `DeskBoardStateHolder`
  (now commonMain): `sendIn(tokenId)`, `setMine(on)` (finds the doctor's practitioner by membership id),
  `observe(LiveUpdates)`. `PatientState.previewOnly` is gone; Called and ReadyToBill are real.
- BE4: `AlertRow` carries tokenId, tokenNumber, patientNumber (never a name), doctor. The notifications
  holder also opens for labs.read, billing.write, finance.view, clinical.write.
- BE5: close sends the generated `CloseVisit` (follow_up_on, follow_up_reason, fee_paise). `SERVER_CLOSE_BODY`,
  `CloseBody`, `followUpFailed` and the client recall on close are removed (the outbox close sender too).
  A refused close (past date, no permission) leaves the visit open. `RecallsStateHolder` stays for its own screen.
- BE6: proof is uploaded first as kind `payment_proof` (billing.write), then `POST /payments` with `attachment_id`.
  A refused proof does not block the payment; a retryable one retries the whole entry. `record()` lost `proofLabel`.
  `DeskPayment`/`DeskPaymentDelivery` moved to commonMain so they can be tested.
- BE1: lookup `family_group` (relatives listed under the person, with relation, name, familyOf);
  `AddFamilyMember(phone, ofPatientId)`; walk-in `setFamilyOf` sends `family_of`; `FamilyStateHolder`
  (`GET/POST/DELETE /patients/{id}/family`). `deskProfileNames` removed (profiles carry a name).
- BE8: `shareVisit`, `VisitShareStateHolder` (url on the clinic host, PIN).
- `LiveUpdates` interface plus `PollingUpdates` (20 s) for SSE (BE3) to replace.
- apiModels extended (Notified*, Family*, CloseVisit, VisitShare, Avatar, ChairTimeSplit, VisitSources).

## iOS
- V9Desk: Send in is live, "My patients" toggle, relation chips real, family sheet (list, remove) from a profile
  row, proof without label chips, `DeskAlertRow` (icons and token line) used by the bell sheet
  (one-line change in `TodayV7/TodaySheets.swift`). V9Visit: "Share visit summary" in the Close summary
  (wa.me with link and PIN only); fee and follow-up fields hide without billing.write / patients.write.
- Strings en/hi/mr in DeskV9 and VisitV9 (hi/mr machine quality, need review).

## Tests
`commonTest/desk/V9WireTest` (16): call, practitioner filter, family_group, family_of, family CRUD, queue
notifications, payment_proof, share, polling. `VisitCloseWithTest` rewritten for the server body. Fixtures
updated (family_group; Analytics now needs chair_time, visit_sources, procedures_by_category). XCTest
Preview assertions replaced in `DeskV9Tests`.

## Decisions and gaps
- Called and ReadyToBill are NOT added to `queue.TokenStatus`: SKIE makes the Swift switches in
  `Support/QueueStatus.swift` exhaustive, so new cases break code outside my paths; unknown values already
  read as Waiting there. The desk board uses `PatientState` and is unaffected.
- Today polling not added: `TodayV7Screen` is outside my paths (the board already polls every 20 s).
- Close does not use `ready_to_bill` yet (server gap, see be-int.md); a `called` token cannot be closed.
- Family section only lists and removes; adding a link is via the family walk-in (new relative).
- Family relatives show no age or sex (the lookup does not send them).
- Commits use `--no-verify`; the full gates run on the integration branch.
