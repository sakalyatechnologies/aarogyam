# v9 consent: ConsentsStateHolder

Branch v9-consent (from 0769804). Shared KMP only; no UI, no user-facing text.

## Built
`ConsentsStateHolder(clinic, patientId, scope)` for the Consent tab (mockup `consentHTML`, `consentSheet`).

## Files (mobile/shared)
- build.gradle.kts: 6 models added to apiModels (Consent, ConsentList, ConsentNotice, ConsentNoticeList, RecordConsent, WithdrawConsent)
- src/commonMain/.../api/ConsentCalls.kt: consents, consentNotices, recordConsent, withdrawConsent
- src/commonMain/.../consents/ConsentsStateHolder.kt
- AppGraph.consents(clinic, patientId, scope)
- src/commonTest/.../consents/ConsentsStateHolderTest.kt

## Public API
- state: Loading | NotAllowed (no patients.read) | Failed(ScreenError) | Loaded(active, withdrawn, notices, canRecord, canWithdraw, busy, failedRecord, error, refreshing)
- refresh(), record(purpose, method, note?), withdraw(consentId, method, note?), clearError()
- ConsentPurpose, ConsentMethod enums map to wire values; unknown purpose gives null plus purposeKey
- Permissions: patients.read to list, patients.write to record/withdraw (else error = NotAllowed, nothing sent)

## Behaviour
- record sends an Idempotency-Key kept across failed attempts, cleared on success; failed input stays in failedRecord
- 409 on record or withdraw means state already changed: reload, no error input kept

## Tests
7 in commonTest: grouping, record success (key header), record failure keeps input and key, withdraw, no-write permission, NotAllowed, offline then recovery.
Result: 7 run, 7 pass (`./gradlew :shared:jvmTest --tests "*ConsentsStateHolderTest*"`).

## Gaps and open questions
- OPEN: does the server honour Idempotency-Key on POST /patients/{id}/consents? RecordConsent has no client id. Backend worker to check. Fallback: the 409 for a duplicate active purpose.
- Notice picker sends no notice_id (server records the current notice); add notice_id if the sheet lets staff choose.

## Next step for iOS
Bridge state to SwiftUI like PatientNotes: collect `state`, render active/withdrawn groups, the record sheet from failedRecord (prefill), withdraw confirm; word ScreenError and enums in Swift.
