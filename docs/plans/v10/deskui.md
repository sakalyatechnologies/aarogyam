# Desk home: earlier sections (deskui)

Branch v10-deskui. Two sections under the board in DeskHomeScreen, in `Screens/V9Desk/DeskEarlierSections.swift`.
- Unpaid from earlier days: `ToCollectHolder`; hidden when NotAllowed/Loading/Failed/empty; Collect opens the payment sheet
  with `DeskPayTarget(patientId, name: patientNumber, invoiceId)`; shown only if `DeskV10Collect.canCollect`.
- Missed today: `MissedHolder`; row tap calls `onOpenPatient`; time in the clinic zone.
- Both collapsible; start collapsed above 3 rows (`DeskV10Earlier.startsCollapsed`).
- Reload: `earlierTick` in DeskHomeScreen, bumped on pull to refresh and on payment sheet dismiss.
- Strings: `dx.earlier.*` in DeskV10.xcstrings (en/hi/mr). Helpers and tests: DeskV10Earlier, DeskV10Tests.
- Status: code written; ios-check not yet completed (paused).
