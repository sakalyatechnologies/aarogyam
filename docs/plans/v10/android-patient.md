# T13 patient worker: Android patient screens (branch v11-and-patient)

Status: all five scopes done, compiled, lint and unit tests green, committed in one commit (see git log). No emulator check yet.

Done vs iOS: v9 page (header, money strip behind eye, quick actions, flags, pill tabs, Start treatment), Overview (jaw chart with tilt, tooth sheet with add/edit treatment, alerts, treatments, last visit, Follow-ups with Dismiss, media), History cards, visit detail (`patient/{id}/visit/{visitId}`: summary, treatment, notes, Rx dose grid, send Rx, files, bill with Record payment), Consent (record, withdraw), Photo/Book/Share sheets, Patients list (search, chips, recall pill). Old RxTab/NotesTab/FilesTab/BillingTab/Patient360Screen deleted, with their now-unused strings.

Deviations: tooth "now" card shows a coloured crown bubble instead of the painted tooth; Android has no eye icons so PatientIcons draws eye/eye_off; the visit detail has its own BillingStateHolder and the page refreshes on resume; jaw tilt sign (rotationX) unverified without emulator.

Openers: `openPatient(id)` kept. `patientDestinations(..., startTreatment: (String) -> Unit = {})`: coordinator passes `nav::openVisitForPatient` at merge.

Needs: visit area keeps `ui/chart` FindingSwatch and label() extensions, strings_chart.xml (chart_*, finding_*, surface_*, kind_*) and rx_* strings used by SendRxSheet. New `ui/RxDays.kt` keeps `daysText` that RxSheet.kt used from the deleted RxTab. NotesLabels.kt and RichTextView.kt are now unused (left in place).
