package com.aarogyam.staff.queue

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.queue
import com.aarogyam.staff.api.setTokenStatus
import com.aarogyam.staff.api.startVisitFromQueue
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Today's waiting room in one `GET /queue`. Seat, Done and Left move a token; Start visit seats
 * it and starts (or reuses) its visit, then emits [opened]. A refused move reloads the queue.
 */
class QueueStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.queue"),
) {
    private val mutableState = MutableStateFlow<QueueState>(QueueState.Loading)
    private val mutableOpened = MutableSharedFlow<VisitOpened>(extraBufferCapacity = 1)

    /** The current screen state. */
    val state: StateFlow<QueueState> = mutableState.asStateFlow()

    /** Visits started here, once each, for the screen to open. */
    val opened: SharedFlow<VisitOpened> = mutableOpened.asSharedFlow()

    init {
        if (APPOINTMENTS_READ in clinic.permissions) load() else mutableState.value = QueueState.NotAllowed
    }

    /** Reloads the queue (pull to refresh, after a failure, or after coming back to the tab). */
    fun refresh() {
        if (mutableState.value == QueueState.NotAllowed) return
        mutableState.update {
            if (it is QueueState.Loaded) it.copy(refreshing = true, actionError = null) else QueueState.Loading
        }
        load()
    }

    fun seat(id: String) = move(id, TokenStatus.InChair)

    fun done(id: String) = move(id, TokenStatus.Done)

    fun left(id: String) = move(id, TokenStatus.Left)

    /** Seats the token and opens its visit; tapping twice opens the same visit. */
    fun startVisit(tokenId: String) {
        val shown = mutableState.value as? QueueState.Loaded ?: return
        if (!shown.canStartVisit || !markBusy(tokenId)) return
        scope.launch {
            when (val result = clinic.api.startVisitFromQueue(tokenId)) {
                is Outcome.Success -> {
                    val started = result.value
                    log.info("queue.visit_started") { id("visit_id", started.visit.id) }
                    replace(started.token.toRow())
                    mutableOpened.emit(VisitOpened(started.visit.patientId, started.visit.id))
                }

                is Outcome.Failure -> {
                    failed("queue.start_visit_failed", result.error)
                }
            }
        }
    }

    private fun move(
        id: String,
        to: TokenStatus,
    ) {
        val shown = mutableState.value as? QueueState.Loaded ?: return
        if (!shown.canMove || !markBusy(id)) return
        scope.launch {
            when (val result = clinic.api.setTokenStatus(id, to.wire)) {
                is Outcome.Success -> replace(result.value.toRow())
                is Outcome.Failure -> failed("queue.move_failed", result.error)
            }
        }
    }

    private fun load() {
        scope.launch {
            when (val result = clinic.api.queue()) {
                is Outcome.Success -> {
                    // A failed action that triggered this reload keeps its message on screen.
                    val actionError = (mutableState.value as? QueueState.Loaded)?.actionError
                    mutableState.value =
                        QueueState.Loaded(
                            rows = result.value.items.map { it.toRow() },
                            canMove = APPOINTMENTS_WRITE in clinic.permissions,
                            canStartVisit = CLINICAL_WRITE in clinic.permissions,
                            actionError = actionError,
                        )
                }

                is Outcome.Failure -> {
                    log.warn("queue.load_failed") { code("error", result.error.code.value) }
                    val error = ScreenError.of(result.error)
                    mutableState.update {
                        if (it is QueueState.Loaded) {
                            it.copy(
                                refreshing = false,
                                actionError = error,
                            )
                        } else {
                            QueueState.Failed(error)
                        }
                    }
                }
            }
        }
    }

    /** Marks [id] busy; false when it is already busy (a double tap). */
    private fun markBusy(id: String): Boolean {
        var marked = false
        mutableState.update { state ->
            if (state !is QueueState.Loaded) return@update state
            val rows =
                state.rows.map {
                    if (it.id == id &&
                        !it.busy
                    ) {
                        it.copy(busy = true).also { marked = true }
                    } else {
                        it
                    }
                }
            state.copy(rows = rows, actionError = null)
        }
        return marked
    }

    private fun replace(row: QueueRow) =
        mutableState.update { state ->
            if (state is QueueState.Loaded) {
                state.copy(
                    rows =
                        state.rows.map {
                            if (it.id ==
                                row.id
                            ) {
                                row
                            } else {
                                it
                            }
                        },
                )
            } else {
                state
            }
        }

    private fun failed(
        event: String,
        error: ApiError,
    ) {
        log.warn(event) { code("error", error.code.value) }
        mutableState.update { if (it is QueueState.Loaded) it.copy(actionError = ScreenError.of(error)) else it }
        // The server is the authority: show what it has now (a refused move, or someone else's change).
        load()
    }

    private companion object {
        const val APPOINTMENTS_READ = "appointments.read"
        const val APPOINTMENTS_WRITE = "appointments.write"
        const val CLINICAL_WRITE = "clinical.write"
    }
}
