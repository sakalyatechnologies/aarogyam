package com.aarogyam.staff

import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.outbox.AudioEnqueue
import com.aarogyam.staff.outbox.enqueueAudio
import com.aarogyam.staff.prescriptions.RxSheetStateHolder
import com.aarogyam.staff.visit.FinishSources
import com.aarogyam.staff.visit.RxSave
import com.aarogyam.staff.visit.VisitStateHolder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// v10 doctor journey helpers for SwiftUI: Swift cannot build suspend lambdas or reach the queue call directly.

fun AppGraph.doctorWaiting(
    clinic: ClinicContext,
    practitionerId: String,
    screen: ScreenScope,
): DoctorWaitingHolder = DoctorWaitingHolder(clinic, practitionerId, screen.scope)

/**
 * What Wrap up hands the finish holder. The Rx draft is saved by the visit's own [RxSheetStateHolder], so there is
 * one draft. Call [prepare] when Wrap up opens and `attach(sources)` again once it reports ready.
 */
class DoctorFinishSources internal constructor(
    private val rx: RxSheetStateHolder,
    private val scope: CoroutineScope,
    visit: VisitStateHolder,
    patientId: String,
) {
    val sources: FinishSources =
        FinishSources(
            patientId = patientId,
            saveNote = { visit.saveNow() },
            saveRx = {
                if (rx.state.value.lines
                        .isEmpty()
                ) {
                    RxSave.Saved(rx.saveDraftNow())
                } else {
                    rx.saveDraftNow()?.let { RxSave.Saved(it) } ?: RxSave.Failed
                }
            },
            rxDraftId = { rx.draftId },
        )

    /** Saves the Rx lines as a draft (when there are any), then calls [onReady] on the main thread. */
    fun prepare(onReady: () -> Unit) {
        scope.launch {
            if (rx.state.value.lines
                    .isNotEmpty()
            ) {
                rx.saveDraftNow()
            }
            onReady()
        }
    }
}

fun AppGraph.finishSources(
    clinic: ClinicContext,
    visit: VisitStateHolder,
    rx: RxSheetStateHolder,
    patientId: String,
    visitId: String,
    screen: ScreenScope,
): DoctorFinishSources = DoctorFinishSources(rx, screen.scope, visit, patientId)

/** Saves a dictation recording for upload once its text is in the note. The files store is the app's one. */
fun AppGraph.enqueueDictationAudio(
    clinic: ClinicContext,
    patientId: String,
    visitId: String?,
    noteId: String?,
    bytes: ByteArray,
    durationSeconds: Int,
    language: String?,
): AudioEnqueue =
    enqueueAudio(
        runner = writes.runner,
        files = outboxFiles,
        clinicSlug = clinic.slug,
        patientId = patientId,
        visitId = visitId,
        noteId = noteId,
        bytes = bytes,
        durationSeconds = durationSeconds,
        language = language,
    )
