package com.aarogyam.staff.chart

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.DentalChart
import com.aarogyam.staff.api.model.NewChartEntries
import com.aarogyam.staff.api.model.NewDentalTerm
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * A patient's dental chart: one request loads every tooth, picking a tooth fetches its history,
 * and a recorded finding is drawn at once and taken back if the server refuses it.
 */
class ChartStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.chart"),
) {
    private data class Model(
        val teeth: Map<Int, ToothView>,
        val dentition: Dentition,
        val selected: Int? = null,
        val surface: Surface? = null,
        val history: HistoryState = HistoryState.Loading,
        val several: Boolean = false,
        val group: List<Int> = emptyList(),
        val terms: List<TermView> = emptyList(),
        val addingTerm: Boolean = false,
        val addedTerm: TermView? = null,
        val termError: ScreenError? = null,
        val saving: Boolean = false,
        val recordError: ScreenError? = null,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    )

    private val canRecord = CLINICAL_WRITE in clinic.permissions
    private var model: Model? = null
    private var historyJob: Job? = null
    private val mutableState = MutableStateFlow<ChartState>(ChartState.Loading)

    /** The current tab state. */
    val state: StateFlow<ChartState> = mutableState.asStateFlow()

    init {
        if (CLINICAL_READ in clinic.permissions) refresh() else mutableState.value = ChartState.NotAllowed
    }

    /** Reloads the chart (and the picked tooth's history, in the same request). */
    fun refresh() {
        val current = model
        when {
            mutableState.value == ChartState.NotAllowed -> return
            current == null -> mutableState.value = ChartState.Loading
            current.refreshing || current.saving -> return
            else -> publish(current.copy(refreshing = true, error = null))
        }
        val tooth = current?.selected
        scope.launch {
            when (val result = clinic.api.dentalChart(patientId, tooth)) {
                is Outcome.Success -> {
                    val base = model ?: Model(emptyMap(), defaultDentition(result.value.current))
                    val teeth = if (base.saving) base.teeth else teethOf(result.value.current)
                    val next = base.copy(teeth = teeth, terms = termsOf(result.value.terms), refreshing = false)
                    publish(if (tooth != null && next.selected == tooth) next.withHistory(result.value) else next)
                }

                is Outcome.Failure -> {
                    logFailure("chart.load_failed", result.error.code.value)
                    val error = ScreenError.of(result.error)
                    val shown = model
                    if (shown == null) {
                        mutableState.value = ChartState.Failed(error)
                    } else {
                        publish(shown.copy(refreshing = false, error = error))
                    }
                }
            }
        }
    }

    /** Shows the adult or the child teeth; a picked tooth of the other set is let go. */
    fun showDentition(dentition: Dentition) {
        val current = model ?: return
        val keep = current.selected?.takeIf { Dentition.of(it) == dentition }
        publish(
            current.copy(
                dentition = dentition,
                selected = keep,
                surface = current.surface.takeIf { keep != null },
                group = current.group.filter { Dentition.of(it) == dentition },
            ),
        )
    }

    /** Turns "Select several" on (starting from the picked tooth) or off. */
    fun setSeveral(on: Boolean) {
        val current = model ?: return
        publish(current.copy(several = on, group = if (on) listOfNotNull(current.selected) else emptyList()))
    }

    /**
     * Picks [tooth] (with [surface], or the whole tooth) and fetches its history. With "Select
     * several" on, a tap on a picked tooth removes it from the group and any other tap adds it.
     */
    fun select(
        tooth: Int,
        surface: Surface? = null,
    ) {
        val current = model ?: return
        if (Dentition.of(tooth) == null) return
        if (current.several) {
            if (surface == null && tooth in current.group) {
                val group = current.group - tooth
                val last = group.lastOrNull()
                publish(current.copy(group = group, selected = last, surface = null, history = HistoryState.Loading))
                if (last != null) loadHistory(last)
                return
            }
            val grouped = if (tooth in current.group) current.group else current.group + tooth
            if (current.selected == tooth) {
                publish(current.copy(group = grouped, surface = surface))
                return
            }
            publish(current.copy(group = grouped, selected = tooth, surface = surface, history = HistoryState.Loading))
            loadHistory(tooth)
            return
        }
        if (current.selected == tooth) {
            publish(current.copy(surface = surface))
            return
        }
        publish(current.copy(selected = tooth, surface = surface, history = HistoryState.Loading))
        loadHistory(tooth)
    }

    /** Looks at one surface of the picked tooth, or the whole tooth. */
    fun selectSurface(surface: Surface?) {
        val current = model ?: return
        if (current.selected != null) publish(current.copy(surface = surface))
    }

    fun clearSelection() {
        val current = model ?: return
        historyJob?.cancel()
        publish(current.copy(selected = null, surface = null, group = emptyList()))
    }

    /**
     * Records [finding] on the picked tooth, or on every tooth of the group with "Select several":
     * on each of [surfaces], or the whole tooth (always, for a whole-tooth finding), with the
     * [procedure] and [material] (ignored for sound). It shows at once; a refusal puts the chart
     * back and sets `recordError`.
     */
    fun record(
        finding: Finding,
        surfaces: List<Surface>,
        procedure: TermView? = null,
        material: TermView? = null,
        note: String? = null,
    ) {
        val current = model ?: return
        val teeth = current.group.takeIf { current.several && it.isNotEmpty() } ?: listOfNotNull(current.selected)
        if (teeth.isEmpty() || !canRecord || current.saving) return
        val before = current.teeth
        val (drawn, entries) = recordPlan(before, teeth, finding, surfaces, procedure, material, note)
        publish(current.copy(teeth = drawn, saving = true, recordError = null))
        scope.launch {
            when (val result = clinic.api.recordDentalChart(patientId, NewChartEntries(entries))) {
                is Outcome.Success -> {
                    val now = model ?: return@launch
                    publish(
                        now.copy(
                            teeth = teethOf(result.value.current),
                            terms = termsOf(result.value.terms),
                            saving = false,
                        ),
                    )
                    now.selected?.takeIf { it in teeth }?.let { loadHistory(it) }
                }

                is Outcome.Failure -> {
                    logFailure("chart.record_failed", result.error.code.value)
                    val now = model ?: return@launch
                    publish(now.copy(teeth = before, saving = false, recordError = ScreenError.of(result.error)))
                }
            }
        }
    }

    /**
     * "Add new" in the procedure or material list: saves [label] for the clinic. The answer (a new
     * term, or the one already there) joins `terms` and shows as `addedTerm` for the sheet to pick.
     */
    fun addTerm(
        kind: TermKind,
        label: String,
    ) {
        val current = model ?: return
        val text = label.trim()
        if (!canRecord || current.addingTerm || text.isEmpty()) return
        publish(current.copy(addingTerm = true, addedTerm = null, termError = null))
        scope.launch {
            val result = clinic.api.addDentalTerm(NewDentalTerm(kind = kind.wire, label = text))
            val now = model ?: return@launch
            when (result) {
                is Outcome.Success -> {
                    val term = termOf(result.value)
                    val terms = if (term == null || now.terms.any { it.id == term.id }) now.terms else now.terms + term
                    publish(now.copy(terms = terms, addingTerm = false, addedTerm = term))
                }

                is Outcome.Failure -> {
                    logFailure("chart.term_failed", result.error.code.value)
                    publish(now.copy(addingTerm = false, termError = ScreenError.of(result.error)))
                }
            }
        }
    }

    /** The sheet has picked the added term, or seen the error. */
    fun consumeAddedTerm() {
        val current = model ?: return
        publish(current.copy(addedTerm = null, termError = null))
    }

    /** The person has seen the record error. */
    fun dismissRecordError() {
        val current = model ?: return
        publish(current.copy(recordError = null))
    }

    private fun loadHistory(tooth: Int) {
        historyJob?.cancel()
        historyJob =
            scope.launch {
                val result = clinic.api.dentalChart(patientId, tooth)
                val now = model ?: return@launch
                if (now.selected != tooth) return@launch
                when (result) {
                    is Outcome.Success -> {
                        // The answer also carries the current chart; keep a pending change on screen.
                        val teeth = if (now.saving) now.teeth else teethOf(result.value.current)
                        publish(now.copy(teeth = teeth, terms = termsOf(result.value.terms)).withHistory(result.value))
                    }

                    is Outcome.Failure -> {
                        logFailure("chart.history_failed", result.error.code.value)
                        publish(now.copy(history = HistoryState.Failed(ScreenError.of(result.error))))
                    }
                }
            }
    }

    private fun Model.withHistory(chart: DentalChart): Model =
        copy(history = HistoryState.Loaded(chart.history.mapNotNull { it.toHistory(clinic.timeZone) }))

    private fun publish(next: Model) {
        model = next
        val view = { tooth: Int -> next.teeth[tooth] ?: ToothView(tooth) }
        val upper = next.dentition.upper.map(view)
        val lower = next.dentition.lower.map(view)
        mutableState.value =
            ChartState.Loaded(
                dentition = next.dentition,
                upper = upper,
                lower = lower,
                needsCare = (upper + lower).count { it.needsCare },
                selected = next.selected?.let { ToothSelection(view(it), next.surface, next.history) },
                several = next.several,
                group = next.group.sorted(),
                terms = next.terms,
                addingTerm = next.addingTerm,
                addedTerm = next.addedTerm,
                termError = next.termError,
                canRecord = canRecord,
                saving = next.saving,
                recordError = next.recordError,
                refreshing = next.refreshing,
                error = next.error,
            )
    }

    private fun logFailure(
        event: String,
        code: String,
    ) = log.warn(event) {
        id("patient", patientId)
        code("error", code)
    }

    private companion object {
        const val CLINICAL_READ = "clinical.read"
        const val CLINICAL_WRITE = "clinical.write"
    }
}
