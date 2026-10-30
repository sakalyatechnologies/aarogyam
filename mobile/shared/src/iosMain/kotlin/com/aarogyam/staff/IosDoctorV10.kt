package com.aarogyam.staff

import com.aarogyam.staff.api.callToken
import com.aarogyam.staff.api.queue
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.outbox.AudioEnqueue
import com.aarogyam.staff.outbox.enqueueAudio
import com.aarogyam.staff.prescriptions.RxSheetStateHolder
import com.aarogyam.staff.visit.FinishSources
import com.aarogyam.staff.visit.RxSave
import com.aarogyam.staff.visit.VisitStateHolder
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// v10 doctor journey helpers for SwiftUI: Swift cannot build suspend lambdas or reach the queue call directly.

/**
 * One patient waiting for this doctor, or sent in ([called]) and not yet seen. Details are for the screen only,
 * never for logs.
 */
data class WaitingPatient(
    val id: String,
    val patientId: String,
    val tokenNumber: Int,
    val ageYears: Int?,
    val sex: String,
    val reason: String?,
    val waitMinutes: Long,
    val called: Boolean = false,
    val busy: Boolean = false,
)

/** The doctor's waiting list; [failed] is true when the last refresh could not reach the clinic. */
data class WaitingState(
    val loaded: Boolean = false,
    val failed: Boolean = false,
    val rows: List<WaitingPatient> = emptyList(),
)

/**
 * The doctor's own queue, refreshed every [POLL_MS]. `waiting` tokens show with Send in, and `called` ones stay with
 * Start visit until the visit seats them; no_show and cancelled never show.
 */
class DoctorWaitingHolder(
    private val clinic: ClinicContext,
    private val practitionerId: String,
    private val scope: CoroutineScope,
) {
    private val mutable = MutableStateFlow(WaitingState())
    val state: StateFlow<WaitingState> = mutable.asStateFlow()

    init {
        scope.launch { pollWhileInFront(POLL_MS) { load() } }
    }

    fun refresh() {
        scope.launch { load() }
    }

    /** Sends the patient in (`waiting` to `called`), the same call the queue uses; the row stays for Start visit. */
    fun sendIn(id: String) {
        mark(id, true)
        scope.launch {
            when (clinic.api.callToken(id)) {
                is Outcome.Success -> {
                    mutable.value =
                        mutable.value.copy(
                            rows =
                                mutable.value.rows.map {
                                    if (it.id ==
                                        id
                                    ) {
                                        it.copy(called = true, busy = false)
                                    } else {
                                        it
                                    }
                                },
                        )
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
                                .filter { it.status == "waiting" || it.status == "called" }
                                .map {
                                    WaitingPatient(
                                        id = it.id,
                                        patientId = it.patient.id,
                                        tokenNumber = it.tokenNumber,
                                        ageYears = it.patient.ageYears,
                                        sex = it.patient.sex,
                                        reason = it.reason?.takeIf { text -> text.isNotBlank() },
                                        waitMinutes = it.waitMinutes,
                                        called = it.status == "called",
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
