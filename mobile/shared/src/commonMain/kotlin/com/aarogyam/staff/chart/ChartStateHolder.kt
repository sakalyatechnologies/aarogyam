package com.aarogyam.staff.chart

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.ChartEntry
import com.aarogyam.staff.api.model.DentalChart
import com.aarogyam.staff.api.model.NewChartEntries
import com.aarogyam.staff.api.model.NewChartEntry
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.moment
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the Chart tab draws. */
sealed interface ChartState {
    data object Loading : ChartState

    /** The role lacks `clinical.read`; nothing was requested. */
    data object NotAllowed : ChartState

    data class Failed(
        val error: ScreenError,
    ) : ChartState

    data class Loaded(
        val dentition: Dentition,
        /** The shown dentition's arches, left to right as the clinician faces the patient. */
        val upper: List<ToothView>,
        val lower: List<ToothView>,
        /** Teeth of the shown dentition with a finding other than sound. */
        val needsCare: Int,
        val selected: ToothSelection?,
        /** The role holds `clinical.write`; without it the record actions are hidden. */
        val canRecord: Boolean,
        /** A finding is on its way to the server (and already drawn). */
        val saving: Boolean,
        /** The last finding could not be saved and was taken off the chart again. */
        val recordError: ScreenError?,
        val refreshing: Boolean,
        /** A refresh failed; the chart on screen is the last one loaded. */
        val error: ScreenError?,
    ) : ChartState {
        /** How many teeth the shown dentition has. */
        val total: Int get() = upper.size + lower.size
    }
}

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
                    val next = base.copy(teeth = teeth, refreshing = false)
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
        publish(current.copy(dentition = dentition, selected = keep, surface = current.surface.takeIf { keep != null }))
    }

    /** Picks [tooth] (with [surface], or the whole tooth) and fetches its history. */
    fun select(
        tooth: Int,
        surface: Surface? = null,
    ) {
        val current = model ?: return
        if (Dentition.of(tooth) == null) return
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
        publish(current.copy(selected = null, surface = null))
    }

    /**
     * Records [finding] on the picked tooth: on [surface], or the whole tooth (always, for a
     * whole-tooth finding). It shows at once; a refusal puts the chart back and sets `recordError`.
     */
    fun record(
        finding: Finding,
        surface: Surface?,
        note: String? = null,
    ) {
        val current = model ?: return
        val tooth = current.selected ?: return
        if (!canRecord || current.saving) return
        val on = if (finding.wholeTooth) null else surface
        val before = current.teeth
        val drawn = (before[tooth] ?: ToothView(tooth)).with(finding, on).copy(pending = true)
        publish(current.copy(teeth = before + (tooth to drawn), saving = true, recordError = null))
        val body =
            NewChartEntries(
                listOf(NewChartEntry(finding.wire, tooth.toLong(), note?.trim()?.takeIf { it.isNotEmpty() }, on?.name)),
            )
        scope.launch {
            when (val result = clinic.api.recordDentalChart(patientId, body)) {
                is Outcome.Success -> {
                    val now = model ?: return@launch
                    publish(now.copy(teeth = teethOf(result.value.current), saving = false))
                    if (now.selected == tooth) loadHistory(tooth)
                }

                is Outcome.Failure -> {
                    logFailure("chart.record_failed", result.error.code.value)
                    val now = model ?: return@launch
                    publish(now.copy(teeth = before, saving = false, recordError = ScreenError.of(result.error)))
                }
            }
        }
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
                        publish(now.copy(teeth = teeth).withHistory(result.value))
                    }

                    is Outcome.Failure -> {
                        logFailure("chart.history_failed", result.error.code.value)
                        publish(now.copy(history = HistoryState.Failed(ScreenError.of(result.error))))
                    }
                }
            }
    }

    private fun Model.withHistory(chart: DentalChart): Model =
        copy(history = HistoryState.Loaded(chart.history.mapNotNull { it.toHistory() }))

    private fun ChartEntry.toHistory(): HistoryEntryView? {
        val finding = Finding.of(finding) ?: return null
        val status =
            when (status) {
                "current" -> EntryStatus.Current
                "superseded" -> EntryStatus.Superseded
                "entered_in_error" -> EntryStatus.EnteredInError
                else -> return null
            }
        return HistoryEntryView(id, finding, Surface.of(surface), status, moment(effectiveAt, clinic.timeZone), note)
    }

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

/** The current entries by tooth; unknown findings and non-FDI numbers are left out. */
private fun teethOf(current: List<ChartEntry>): Map<Int, ToothView> {
    val teeth = mutableMapOf<Int, ToothView>()
    for (entry in current) {
        if (entry.status != "current" || Dentition.of(entry.tooth) == null) continue
        val finding = Finding.of(entry.finding) ?: continue
        val surface = Surface.of(entry.surface)
        if (entry.surface != null && surface == null) continue
        val tooth = teeth[entry.tooth] ?: ToothView(entry.tooth)
        teeth[entry.tooth] =
            if (surface == null) tooth.copy(whole = finding) else tooth.with(finding, surface)
    }
    return teeth
}

/** Children's charts open on the primary teeth: a chart with only primary-tooth entries. */
private fun defaultDentition(current: List<ChartEntry>): Dentition {
    val sets = current.mapNotNull { Dentition.of(it.tooth) }.toSet()
    return if (sets == setOf(Dentition.Child)) Dentition.Child else Dentition.Adult
}
