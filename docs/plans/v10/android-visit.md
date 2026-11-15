# T13 visit worker (Android)

Branch `v11-and-visit`. Files: `mobile/androidApp/src/main/kotlin/com/aarogyam/staff/android/ui/visit/*`, `res/values*/strings_visit.xml` (generated from the iOS xcstrings by a script, pruned to used keys).

## Done (ported from iOS)
- VisitScreen/VisitContent/VisitHeader/VisitNotes/VisitProcedures (+tooth line, surfaces, material), VisitRxCard/VisitMedCard/RxDelivery (inline Rx), VisitClose (close area, summary), VisitShare, WrapUpSheet, ChairMode, AndroidDictation, VisitRoutes.
- Openers: `NavController.openVisitFromQueue(tokenId)` (patient read from the queue), `openVisitForPatient(patientId)`.

## Left / needs from others
- Shell: pass `dictation = AndroidDictation(this)` to `AppGraph.create` in `AarogyamApp.kt`; add `<uses-permission android:name="android.permission.RECORD_AUDIO" />` to the manifest.
- Coordinator: `onCollect` in `VisitRoutes.kt` only pops back; wire to `nav.openDeskPayment(tokenId, invoiceId)` after the desk merge.
- Chair mode does not record audio beside dictation (the mic is held by SpeechRecognizer on Android); iOS `enqueueDictationAudio` has no Android twin yet.
- No chair number from the queue (header shows "In treatment").
