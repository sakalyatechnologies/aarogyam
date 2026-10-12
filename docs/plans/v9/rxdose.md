# v9 rxdose: Rx dosing model (branch v9-rxdose)

## Built
Pure shared-Kotlin dosing model for the inline prescription composer. No user-facing text.

## Files (mobile/shared/src)
- commonMain/.../prescriptions/RxDose.kt: RxDose, DoseSlot, unitsTotal, RxTiming, RX_MIN_DAYS/RX_MAX_DAYS
- commonMain/.../prescriptions/RxLineDraft.kt: editable line <-> generated RxItem
- commonTest/.../prescriptions/RxDosingTest.kt: 8 tests

## Public API
- `RxDose(morning, afternoon, night)` in halves (Int): 0, 1 (1/2), 2 (one), 4 (two).
  `cycle(slot)` 0 -> 1/2 -> 1 -> 2 -> 0; `isEmpty`; `dailyHalves`; `halves(slot)`; `format()` ("1-0-1", "½-0-½").
  `RxDose.parse(text)` reads "1-0-1", "½-0-½", "0.5-0-1"; returns null for anything else, never throws.
- `unitsTotal(dose, days, form): Int?` tablets/capsules rounded up; null for liquid, rinse, gel, unknown form.
- `RxTiming` enum with `.api` and `fromApi(String?)` (before_food, after_food, empty_stomach, bedtime, sos, as_directed).
- `RxLineDraft`: `fromItem(RxItem)`, `toItem()`, `isValid` (days 1..90 and a non-zero dose; SOS may have no dose),
  `frequencyText`, `total`, `withDays(n)` (clamps), `cycled(slot)`.
  Unreadable frequency/timing stays in `rawFrequency`/`rawTiming` and is sent back unchanged.

## Tests
`./gradlew :shared:jvmTest --tests '*RxDos*'` from mobile/ (result in the commit report).

## Gaps
- Not wired into RxSheetStateHolder or RxLine yet; the old RxLine/toItem path is untouched.
- Halves only (no 1.5 or 3 steps); "1.5-0-0" is kept raw.
- Draft days default to 5 when the item has none; the API allows up to 365, the composer 90.
- `total` for an SOS line is the maximum possible; the screen words "up to".

## Next (iOS worker)
Hold an `RxLineDraft` per line; tap a slot calls `cycled(slot)`; stepper calls `withDays`;
show `total` (null: show no count); render `frequencyText` / `rawFrequency` as-is; send `toItem()`.
Map `RxTiming` to localized labels in the UI layer.
