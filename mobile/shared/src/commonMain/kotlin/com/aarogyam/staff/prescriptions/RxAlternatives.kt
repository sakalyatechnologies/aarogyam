package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.drugAlternatives
import com.aarogyam.staff.api.model.Drug
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The "Alternatives" list for one added medicine (`GET /drugs/{id}/alternatives`: same generic,
 * strength and form, by brand). Only for roles with `prescriptions.issue`, like the rest of the sheet.
 */
internal class RxAlternatives(
    private val clinic: ClinicContext,
    private val state: MutableStateFlow<RxSheetState>,
    private val scope: CoroutineScope,
    private val log: Logger,
) {
    private var job: Job? = null

    /** Loads the alternatives of the line [key]; a line typed by hand (no catalogue id) has none to ask for. */
    fun open(key: Int) {
        val current = state.value
        val drugId = current.lines.firstOrNull { it.key == key }?.drugId
        if (!current.allowed || current.phase != RxPhase.Composing || drugId == null) return
        job?.cancel()
        state.update { it.copy(alternatives = AlternativesState(key, loading = true)) }
        job =
            scope.launch {
                val next =
                    when (val answer = clinic.api.drugAlternatives(drugId)) {
                        is Outcome.Success -> {
                            // The medicine itself is not an alternative to itself.
                            AlternativesState(key, items = answer.value.filter { it.id != drugId }.map(Drug::toView))
                        }

                        is Outcome.Failure -> {
                            log.warn("rxsheet.alternatives_failed") { code("error", answer.error.code.value) }
                            AlternativesState(key, error = ScreenError.of(answer.error))
                        }
                    }
                state.update { if (it.alternatives?.lineKey == key) it.copy(alternatives = next) else it }
            }
    }

    fun close() {
        job?.cancel()
        state.update { it.copy(alternatives = null) }
    }
}
