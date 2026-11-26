package com.aarogyam.staff.today

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.NewSterilisationCycle
import com.aarogyam.staff.api.model.SterilisationCycle
import com.aarogyam.staff.api.recordSterilisationCycle
import com.aarogyam.staff.api.sterilisationCycles
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalTime
import kotlinx.datetime.toLocalDateTime

/** One autoclave run today. */
data class CycleView(
    val id: String,
    val ranAt: LocalTime?,
    val loadNote: String?,
    val recordedBy: String?,
)

/** Today's sterilisation cycles for the "Log a cycle" sheet. */
data class CycleLogState(
    val cycles: List<CycleView> = emptyList(),
    val loading: Boolean = false,
    val saving: Boolean = false,
    val error: ScreenError? = null,
)

/**
 * Lists today's sterilisation cycles and records a new one that ran now. Both need `tasks.use`;
 * without it [allowed] is false and nothing is requested. [onLogged] refreshes the Me card's count.
 */
class CycleLogHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger,
    private val onLogged: () -> Unit,
) {
    val allowed: Boolean = "tasks.use" in clinic.permissions
    private val mutable = MutableStateFlow(CycleLogState())
    val state: StateFlow<CycleLogState> = mutable.asStateFlow()

    /** Loads today's list (when the sheet opens). */
    fun load() {
        if (!allowed || mutable.value.loading) return
        mutable.value = mutable.value.copy(loading = true, error = null)
        scope.launch {
            when (val answer = clinic.api.sterilisationCycles()) {
                is Outcome.Success -> {
                    mutable.value = CycleLogState(cycles = answer.value.items.map { it.toView() })
                }

                is Outcome.Failure -> {
                    log.warn("today.cycles_failed") { code("error", answer.error.code.value) }
                    mutable.value = mutable.value.copy(loading = false, error = ScreenError.of(answer.error))
                }
            }
        }
    }

    /** Records a cycle that ran now, with an optional [note] about the load. */
    fun record(note: String) {
        if (!allowed || mutable.value.saving) return
        val text = note.trim().take(MAX_NOTE).ifEmpty { null }
        mutable.value = mutable.value.copy(saving = true, error = null)
        scope.launch {
            when (val answer = clinic.api.recordSterilisationCycle(NewSterilisationCycle(loadNote = text))) {
                is Outcome.Success -> {
                    log.info("sterilisation.cycle_logged")
                    mutable.value = CycleLogState(cycles = listOf(answer.value.toView()) + mutable.value.cycles)
                    onLogged()
                }

                is Outcome.Failure -> {
                    log.warn("today.cycle_failed") { code("error", answer.error.code.value) }
                    mutable.value = mutable.value.copy(saving = false, error = ScreenError.of(answer.error))
                }
            }
        }
    }

    private fun SterilisationCycle.toView() =
        CycleView(
            id = id,
            ranAt = parseInstant(runAt)?.toLocalDateTime(clinic.timeZone)?.time,
            loadNote = loadNote,
            recordedBy = recordedByName,
        )

    private companion object {
        const val MAX_NOTE = 120
    }
}
