# v9 Overview tab and money strip (shared module)

## Built
`PatientOverviewStateHolder(clinic, patientId, scope)` for the new patient page's Overview tab and header money strip. Shared code has no user-facing text.

## Files (mobile/shared/src)
- commonMain/.../patients/PatientOverviewState.kt: state and view types.
- commonMain/.../patients/PatientOverviewMapping.kt: status mapping, treatments, flags, last visit, media, money.
- commonMain/.../patients/PatientOverviewStateHolder.kt: the holder.
- commonTest/.../patients/PatientOverviewStateHolderTest.kt: 8 tests.

## Public API
- `state: StateFlow<OverviewState>`: Loading, NotAllowed (no clinical.read), Failed(ScreenError; Offline is ScreenError.Offline), Loaded.
- `Loaded`: `treatments: List<TreatmentRow(tooth, date, finding, procedure, status)>`, `alerts: FlagsView`, `lastVisit: LastVisitView?`, `media: List<MediaView>` (xray/photo, newest 12), `money: MoneySummary?`, `moneyShown`, `refreshing`, `error`.
- `TxStatus`: Done, InProgress, Planned, Watch. Mapping: watch -> Watch; caries, fractured -> Planned; root_canal -> InProgress until the tooth has a crown, then Done; the rest -> Done. Sound is skipped. One row per tooth and day (most urgent status wins); newest day first.
- `MoneySummary(visits, paidPaise, remainingPaise)`: null without billing.read (the assistant), so draw no strip. `toggleMoney()` flips `moneyShown`; it starts false, lives in memory only, and does nothing without money.
- `refresh()`: keeps the screen while reloading; a 403 on visits, files or bills leaves that part empty.

## Tests (all 8 pass, `:shared:jvmTest --tests '*PatientOverviewStateHolderTest*'`)
Status mapping, other parts, money hidden by default and toggling, new holder hidden again, assistant has no money and no invoice request, empty states, NotAllowed, failure.

## Gaps
- No `PatientBalance` client call exists and that schema has no paid or visit count, so money sums issued invoices (drafts and void ignored); visits count is the visits list size.
- Treatments read `dentalChart` directly with the `ChartStateHolder` mappings (Finding, ChartEntry.procedure), not through its state: the holder exposes no entry dates.
- Not wired into AppGraph; no UI. Offline-with-cache is not implemented (a failed refresh keeps the shown data and sets `error`).

## Next for iOS
Add `graph.patientOverview(clinic, id, scope)`, observe `state`, map TxStatus and Finding to copy and pills, show the strip only when `money != null`, call `toggleMoney()` from the eye button.
