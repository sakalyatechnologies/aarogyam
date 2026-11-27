package com.aarogyam.staff.chart

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.completeProcedure
import com.aarogyam.staff.api.patientProcedures
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One treatment on a tooth: planned or done. A planned one is finished with a tap on its status. */
data class ToothTreatment(
    val id: String,
    val name: String,
    val surfaces: List<String>,
    val done: Boolean,
)

data class ToothTreatmentsState(
    val items: List<ToothTreatment> = emptyList(),
    /** The treatment being marked done. */
    val busy: String? = null,
    val error: ScreenError? = null,
)

/** The tooth sheet's treatment rows (the patient's procedures on this tooth) and their status chips. */
internal class ToothTreatments(
    private val clinic: ClinicContext,
    private val chart: ChartStateHolder,
    private val scope: CoroutineScope,
    private val log: Logger,
) {
    private val mutable = MutableStateFlow(ToothTreatmentsState())
    val state: StateFlow<ToothTreatmentsState> = mutable.asStateFlow()

    fun open(tooth: Int) {
        mutable.value = ToothTreatmentsState()
        scope.launch {
            val answer = clinic.api.patientProcedures(chart.patientId)
            if (answer is Outcome.Success) {
                val rows =
                    answer.value.items
                        .filter { it.tooth == tooth && it.status in SHOWN }
                        .map { ToothTreatment(it.id, it.name, it.surfaces, it.status == DONE) }
                mutable.update { it.copy(items = rows) }
            }
        }
    }

    /** Planned becomes done: shown at once, put back if refused. */
    fun complete(id: String) {
        if (mutable.value.busy != null) return
        mutable.update { s ->
            s.copy(busy = id, error = null, items = s.items.map { if (it.id == id) it.copy(done = true) else it })
        }
        scope.launch {
            when (val answer = clinic.api.completeProcedure(id)) {
                is Outcome.Success -> {
                    log.info("chart.treatment_done")
                    mutable.update { it.copy(busy = null) }
                }

                is Outcome.Failure -> {
                    log.warn("chart.treatment_done_failed") { code("error", answer.error.code.value) }
                    mutable.update { s ->
                        s.copy(
                            busy = null,
                            error = ScreenError.of(answer.error),
                            items = s.items.map { if (it.id == id) it.copy(done = false) else it },
                        )
                    }
                }
            }
        }
    }

    private companion object {
        const val DONE = "done"
        val SHOWN = setOf("planned", DONE)
    }
}
