package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.api.checkAllergies
import com.aarogyam.staff.api.model.AllergyCheckItem
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The clinic's allergy check while lines are added (`POST /patients/{id}/allergy-check`), 400 ms
 * after the medicines change. It only warns: Issue runs its own check and asks for the reason.
 * Alerts are clinical text: shown, never logged. A failed check keeps the earlier alerts (warning
 * too much beats too little) and the next change tries again.
 */
internal class RxAllergyCheck(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val state: MutableStateFlow<RxSheetState>,
    private val scope: CoroutineScope,
    private val log: Logger,
) {
    private var job: Job? = null
    private var checked: List<Pair<String?, String>>? = null

    /** Call after the lines changed; the same medicines as last time ask nothing. */
    fun schedule() {
        if (!state.value.allowed) return
        val items = itemsOf(state.value.lines)
        val key = items.map { it.drugId to it.drugName }
        if (key == checked) return
        job?.cancel()
        if (items.isEmpty()) {
            checked = key
            state.update { it.copy(checkAlerts = emptyList()) }
            return
        }
        job =
            scope.launch {
                delay(DEBOUNCE_MS)
                when (val answer = clinic.api.checkAllergies(patientId, items)) {
                    is Outcome.Success -> {
                        checked = key
                        val alerts = answer.value.alerts.map { ServerAlert(severityOf(it.severity), it.message) }
                        state.update { it.copy(checkAlerts = alerts) }
                    }

                    is Outcome.Failure -> {
                        log.info("rxsheet.allergy_check_failed") { code("error", answer.error.code.value) }
                    }
                }
            }
    }

    internal companion object {
        const val DEBOUNCE_MS = 400L
        const val MAX_ITEMS = 50
        const val MAX_NAME = 200

        /** The named lines, as the server takes them: non-blank names, at most 50 lines of 200 characters. */
        fun itemsOf(lines: List<RxLine>): List<AllergyCheckItem> =
            lines
                .mapNotNull { line ->
                    line.name
                        .trim()
                        .takeIf(String::isNotEmpty)
                        ?.let { AllergyCheckItem(drugName = it.take(MAX_NAME), drugId = line.drugId) }
                }.take(MAX_ITEMS)
    }
}
