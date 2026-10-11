# v9 front desk (shared module)

Branch v9-desk, base 0769804. No user-facing text in shared code; platforms map enums to copy.

## Built (mobile/shared/src/commonMain/kotlin/com/aarogyam/staff/desk/)
- PatientState.kt: enum Waiting, Called*, InConsult, InChair, ReadyToBill*, Done, Left (* previewOnly) and
  `patientState(tokenStatus, calledAt, openVisit, appointmentStatus): PatientState?`.
- PhoneNumbers.kt: `normaliseIndianPhone(typed): String?` -> "+91XXXXXXXXXX" or null.
- DeskLookupModels.kt: DeskAction, DeskProfile, DeskLookupState, `initialsOf`.
- DeskLookupStateHolder.kt: debounced POST /patients/lookup, queue-derived check-in flag, CheckIn via POST /walk-ins.

## Public API
- `DeskLookupStateHolder(clinic, scope, log, debounceMillis)`; `state: StateFlow<DeskLookupState>`;
  `search(typed)`, `checkIn(patientId)`.
- States: Idle, Looking, Matches(phone, profiles, actions), NoMatch(phone, actions), Failed(ScreenError), NotAllowed,
  CheckedIn(patientId, tokenNumber).
- Actions: NewPatient(prefilledPhone), AddFamilyMember(phone), CheckIn(patientId).
- Needs patients.read, appointments.read, appointments.write, intake.write.
- The phone is never logged (ids and error codes only).

## Hooks for the backend worker
- `DeskProfile.lastVisit` (null until lookup returns it) and `DeskProfile.relation` (null until family relations).
- Called and ReadyToBill: "called" / "ready_to_bill" strings already map; `called_at` is a mapper argument, but the
  mobile QueueToken model does not carry it yet, so the holder passes only the token status.
- POST /queue/{id}/call: no client call yet.

## Tests (commonTest/.../desk/)
- PatientStateTest (mapper table, previewOnly), PhoneNumbersTest (formats, invalid, initials),
  DeskLookupStateHolderTest (one, many, none, offline, NotAllowed, check-in request, no phone in logs).
- Result: 11 tests, 0 failures (`./gradlew :shared:jvmTest --tests "*desk*"`).

## Gaps
- Check-in always records verbal care consent; no doctor choice or reminders consent.
- No QueueToken.calledAt in the model; the checked-in flag therefore never shows Called.
- `AppGraph.desk(clinic, scope)` is the factory.

## Next for iOS
- Add `AppGraph.desk(clinic, scope)`, collect `state` in SwiftUI, draw the picker, map PatientState and
  ScreenError to copy and colour, and open walk-in/new-patient from the actions.
