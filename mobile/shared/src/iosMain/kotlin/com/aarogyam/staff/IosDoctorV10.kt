package com.aarogyam.staff

import com.aarogyam.staff.api.callToken
import com.aarogyam.staff.api.queue
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.outbox.AudioEnqueue
import com.aarogyam.staff.outbox.ProtectedOutboxFiles
import com.aarogyam.staff.outbox.enqueueAudio
import com.aarogyam.staff.prescriptions.RxDraftSync
import com.aarogyam.staff.prescriptions.RxSheetStateHolder
import com.aarogyam.staff.visit.FinishSources
import com.aarogyam.staff.visit.RxSave
import com.aarogyam.staff.visit.VisitStateHolder
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// v10 doctor journey helpers for SwiftUI: Swift cannot build suspend lambdas or reach the queue call directly.

/** One patient waiting for this doctor. Details are for the screen only, never for logs. */
data class WaitingPatient(
    val id: String,
    val tokenNumber: Int,
    val ageYears: Int?,
    val sex: String,
    val reason: String?,
    val waitMinutes: Long,
    val busy: Boolean = false,
)

/** The doctor's waiting list; [failed] is true when the last refresh could not reach the clinic. */
data class WaitingState(
    val loaded: Boolean = false,
    val failed: Boolean = false,
    val rows: List<WaitingPatient> = emptyList(),
)

/** The doctor's own queue, refreshed every [POLL_MS]; only `waiting` tokens show (no_show and cancelled never do). */
class DoctorWaitingHolder(
    private val clinic: ClinicContext,
    private val practitionerId: String,
    private val scope: CoroutineScope,
) {
    private val mutable = MutableStateFlow(WaitingState())
    val state: StateFlow<WaitingState> = mutable.asStateFlow()

    init {
        scope.launch {
            while (true) {
                load()
                delay(POLL_MS)
            }
        }
    }

    fun refresh() {
        scope.launch { load() }
    }

    /** Sends the patient in (`waiting` to `called`), the same call the queue uses. */
    fun sendIn(id: String) {
        mark(id, true)
        scope.launch {
            when (clinic.api.callToken(id)) {
                is Outcome.Success -> {
                    mutable.value =
                        mutable.value.copy(rows = mutable.value.rows.filterNot { it.id == id })
                }

                is Outcome.Failure -> {
                    mark(id, false)
                }
            }
        }
    }

    private fun mark(
        id: String,
        busy: Boolean,
    ) {
        mutable.value =
            mutable.value.copy(rows = mutable.value.rows.map { if (it.id == id) it.copy(busy = busy) else it })
    }

    private suspend fun load() {
        when (val result = clinic.api.queue(practitionerId)) {
            is Outcome.Success -> {
                mutable.value =
                    WaitingState(
                        loaded = true,
                        rows =
                            result.value.items
                                .filter { it.status == "waiting" }
                                .map {
                                    WaitingPatient(
                                        id = it.id,
                                        tokenNumber = it.tokenNumber,
                                        ageYears = it.patient.ageYears,
                                        sex = it.patient.sex,
                                        reason = it.reason?.takeIf { text -> text.isNotBlank() },
                                        waitMinutes = it.waitMinutes,
                                    )
                                },
                    )
            }

            is Outcome.Failure -> {
                mutable.value = mutable.value.copy(loaded = true, failed = true)
            }
        }
    }

    private companion object {
        const val POLL_MS = 20_000L
    }
}

fun AppGraph.doctorWaiting(
    clinic: ClinicContext,
    practitionerId: String,
    screen: ScreenScope,
): DoctorWaitingHolder = DoctorWaitingHolder(clinic, practitionerId, screen.scope)

/**
 * What Wrap up hands the finish holder. The Rx draft is pushed through its own [RxDraftSync] because the Rx sheet
 * holder keeps its draft id private (seam: see docs/plans/v10/t9.md). Call [prepare] when Wrap up opens and
 * `attach(sources)` again once it reports ready.
 */
class DoctorFinishSources internal constructor(
    private val rx: RxSheetStateHolder,
    private val sync: RxDraftSync,
    private val scope: CoroutineScope,
    visit: VisitStateHolder,
    patientId: String,
) {
    val sources: FinishSources =
        FinishSources(
            patientId = patientId,
            saveNote = { visit.saveNow() },
            saveRx = {
                val lines = rx.state.value.lines
                if (lines.isEmpty()) {
                    RxSave.Saved(sync.id)
                } else {
                    when (val pushed = sync.push(lines)) {
                        is Outcome.Success -> RxSave.Saved(pushed.value)
                        is Outcome.Failure -> RxSave.Failed
                    }
                }
            },
            rxDraftId = { sync.id },
        )

    /** Pushes the Rx lines as a draft (when there are any), then calls [onReady] on the main thread. */
    fun prepare(onReady: () -> Unit) {
        val lines = rx.state.value.lines
        scope.launch {
            if (lines.isNotEmpty()) sync.push(lines)
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
): DoctorFinishSources =
    DoctorFinishSources(rx, RxDraftSync(clinic, patientId, visitId), screen.scope, visit, patientId)

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
        files = ProtectedOutboxFiles(),
        clinicSlug = clinic.slug,
        patientId = patientId,
        visitId = visitId,
        noteId = noteId,
        bytes = bytes,
        durationSeconds = durationSeconds,
        language = language,
    )
