# T13 patient worker: Android patient screens (branch v11-and-patient)

Status (resume here): code for the v9 page written under `mobile/androidApp/.../ui/patient/`, not yet compiled or committed.

Written (uncommitted): PatientLogic (+test), PatientKit, PatientHeader (money strip behind eye, quick actions, flags, pill tabs), PatientPage, OverviewTab, JawChart, ToothSheet, AddTreatmentForm, FollowUpsCard, HistoryTab, VisitDetail(+Cards, MedicineCard, DoseDisplay +test), PaymentSheet, SendRxSheet, ConsentTab, RecordConsentSheet, PhotoSheet, BookSheet, OutboxBadge, PatientIcons.

To do: ShareSheet, PatientRoutes (host PatientPage + visit detail route, `startTreatment` lambda param), strings_patient.xml en/hi/mr (generate from PatientV9/PatientV7 xcstrings; only used keys), PatientsScreen (chips, due pill), delete old tabs (RxTab, NotesTab, FilesTab, BillingTab, Patient360Screen) and their unused strings, compile, lint, commit.

Needs from others: visit area `openVisitForPatient(patientId)`: wire into `patientDestinations` `startTreatment` default at merge. Reuses visit-owned `ui/chart` (FindingSwatch, label()), strings_chart.xml, RxSheet strings (rx_*).
