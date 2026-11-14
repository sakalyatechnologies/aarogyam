# Medicine sets in the visit prescription card

One tap adds a whole set (e.g. dental "Post-extraction", or a clinic's own set) to the prescription.

## Built
- `RxSheetStateHolder` loads `clinic.reference.quickPicks()` once on creation (only if `prescriptions.issue`); state gets `sets: List<RxSetChip>(id, label, count)`. A failed load leaves it empty and logs `rxsheet.sets_unavailable` with the error code only.
- `addSet(id)`: appends the set's lines after existing ones with fresh keys, skips medicines already on the prescription (case-insensitive), clears query/results, marks draft dirty, recomputes allergy warnings.
- Mapping in `prescriptions/RxSets.kt`: `drugId = null`, `name = drugName`, `detail = "strength form"`, `durationDays = durationDays ?: 5`.
- iOS: `V9VisitRxSets.swift` chip row in the composer, above Quick Rx, shown when the search field is empty; disabled while issuing; a11y label "Add set <label>, <n> medicines" (`v9v.rx.set.a11y`, en/hi/mr).

## Files
`shared/.../prescriptions/{RxSets.kt (new), RxSheetModels.kt, RxSheetStateHolder.kt}`, `commonTest/.../prescriptions/RxSetsTest.kt` (5 tests), `iosApp/AarogyamStaff/Screens/V9Visit/{V9VisitRx.swift, V9VisitRxSets.swift}`, `VisitV9.xcstrings`.

## Gaps
- A set's `instructions` have no `RxLine` field and are dropped.
- Set medicines are free-text lines (no catalogue id), so the server matches by name.
- `RxSheetStateHolder.kt` is now ~398 lines (was 358, already over the 300 rule); a split is due.
- No Swift logic added, so no new XCTest; the chip view is not snapshot-tested.
