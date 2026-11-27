package com.aarogyam.staff.chart

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.DentalChart
import com.aarogyam.staff.api.model.NewChartEntries
import com.aarogyam.staff.api.model.NewChartEntry
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
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock
import kotlin.time.Instant

/**
 * A patient's dental chart: one request loads every tooth, picking a tooth fetches its history,
 * and a recorded finding is drawn at once and taken back if the server refuses it.
 */
class ChartStateHolder(
    private val clinic: ClinicContext,
    internal val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.chart"),
    private val now: () -> Instant = { Clock.System.now() },
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
        val statuses: Map<Int, ToothStatusView> = emptyMap(),
        val noted: Set<Int> = emptySet(),
        val conditions: Map<Int, ToothConditionView> = emptyMap(),
        val eruptions: Map<Int, ToothEruptionView> = emptyMap(),
        val caries: Map<Int, List<CariesMark>> = emptyMap(),
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
                    val next =
                        base
                            .withChart(result.value, keepPending = true)
                            .copy(statuses = statusesOf(result.value.statuses, clinic.timeZone), refreshing = false)
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
        /** The current entry this corrects, when the correction moves it to another surface. */
        supersedes: String? = null,
        /** The work was done by another dentist. */
        elsewhere: Boolean = false,
        /** The treatment is started and not finished. */
        inProgress: Boolean = false,
    ) {
        val current = model ?: return
        val teeth = current.group.takeIf { current.several && it.isNotEmpty() } ?: listOfNotNull(current.selected)
        if (teeth.isEmpty() || !canRecord || current.saving) return
        val before = current.teeth
        val (drawn, entries) =
            recordPlan(
                before,
                teeth,
                finding,
                surfaces,
                procedure,
                material,
                note,
                supersedes,
                elsewhere,
                inProgress,
            )
        publish(current.copy(teeth = drawn, saving = true, recordError = null))
        scope.launch {
            when (val result = clinic.api.recordDentalChart(patientId, NewChartEntries(entries))) {
                is Outcome.Success -> {
                    val now = model ?: return@launch
                    publish(
                        now
                            .copy(saving = false)
                            .withChart(result.value, keepPending = false)
                            .copy(statuses = statusesOf(result.value.statuses, clinic.timeZone)),
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
                        publish(now.withChart(result.value, keepPending = true).withHistory(result.value))
                    }

                    is Outcome.Failure -> {
                        logFailure("chart.history_failed", result.error.code.value)
                        publish(now.copy(history = HistoryState.Failed(ScreenError.of(result.error))))
                    }
                }
            }
    }

    /**
     * The teeth, terms and details from a chart answer. With [keepPending], a change still on its
     * way keeps its teeth and decay marks on screen.
     */
    private fun Model.withChart(
        chart: DentalChart,
        keepPending: Boolean,
    ): Model {
        val keep = keepPending && saving
        return copy(
            teeth = if (keep) teeth else teethOf(chart.current),
            caries = if (keep) caries else cariesOf(chart.current),
            terms = termsOf(chart.terms),
            noted =
                chart.toothNotes
                    .orEmpty()
                    .map { it.tooth }
                    .toSet(),
            conditions = conditionsOf(chart.conditions, clinic.timeZone),
            eruptions = eruptionsOf(chart.eruptions, clinic.timeZone),
        )
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
                selected =
                    next.selected?.let {
                        ToothSelection(
                            view(it),
                            next.surface,
                            next.history,
                            next.statuses[it],
                            detailsOf(
                                view(it),
                                next.conditions[it],
                                next.eruptions[it],
                                next.caries[it].orEmpty(),
                                next.history,
                                now().toLocalDateTime(clinic.timeZone).date,
                            ),
                        )
                    },
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
                statuses = next.statuses,
                notedTeeth = next.noted,
            )
    }

    /** A note was saved on [tooth]: it gets its dot without reloading the chart. */
    internal fun markNoted(tooth: Int) {
        val current = model ?: return
        publish(current.copy(noted = current.noted + tooth))
    }

    /**
     * Records [depth] on every current decay mark of [tooth], keeping each mark's surface, note,
     * procedure and material. It shows at once; a refusal puts the marks back and sets `recordError`.
     */
    fun recordCariesDepth(
        tooth: Int,
        depth: CariesDepth,
    ) {
        val current = model ?: return
        val marks = current.caries[tooth].orEmpty()
        if (marks.isEmpty() || !canRecord || current.saving) return
        if (marks.all { it.depth == depth }) return
        val entries =
            marks.map {
                NewChartEntry(
                    finding = Finding.Caries.wire,
                    tooth = tooth.toLong(),
                    surface = it.surface?.name,
                    note = it.note,
                    procedure = it.procedure,
                    material = it.material,
                    cariesDepth = depth.wire,
                )
            }
        val before = current.caries
        publish(
            current.copy(
                caries =
                    before + (
                        tooth to
                            marks.map {
                                it.copy(depth = depth)
                            }
                    ),
                saving = true,
                recordError = null,
            ),
        )
        scope.launch {
            when (val result = clinic.api.recordDentalChart(patientId, NewChartEntries(entries))) {
                is Outcome.Success -> {
                    log.info("chart.caries_depth_set")
                    val now = model ?: return@launch
                    publish(now.copy(saving = false).withChart(result.value, keepPending = false))
                    now.selected?.takeIf { it == tooth }?.let { loadHistory(it) }
                }

                is Outcome.Failure -> {
                    logFailure("chart.caries_depth_failed", result.error.code.value)
                    val now = model ?: return@launch
                    publish(now.copy(caries = before, saving = false, recordError = ScreenError.of(result.error)))
                }
            }
        }
    }

    internal fun conditionOf(tooth: Int): ToothConditionView? = model?.conditions?.get(tooth)

    internal fun eruptionOf(tooth: Int): ToothEruptionView? = model?.eruptions?.get(tooth)

    /** Shows [condition] on [tooth] (null: none); the tooth sheet saves it. */
    internal fun applyCondition(
        tooth: Int,
        condition: ToothConditionView?,
    ) {
        val current = model ?: return
        publish(
            current.copy(
                conditions =
                    if (condition ==
                        null
                    ) {
                        current.conditions - tooth
                    } else {
                        current.conditions + (tooth to condition)
                    },
            ),
        )
    }

    /** Shows [eruption] on [tooth] (null: none); the tooth sheet saves it. */
    internal fun applyEruption(
        tooth: Int,
        eruption: ToothEruptionView?,
    ) {
        val current = model ?: return
        publish(
            current.copy(
                eruptions =
                    if (eruption ==
                        null
                    ) {
                        current.eruptions - tooth
                    } else {
                        current.eruptions + (tooth to eruption)
                    },
            ),
        )
    }

    /** [tooth] as the chart shows it now (sound when nothing is recorded). */
    internal fun toothView(tooth: Int): ToothView = model?.teeth?.get(tooth) ?: ToothView(tooth)

    /** The doctor's status on [tooth], if any. */
    internal fun statusOf(tooth: Int): ToothStatusView? = model?.statuses?.get(tooth)

    /** Shows [status] on [tooth] (null: back to what its findings suggest); the tooth sheet saves it. */
    internal fun applyStatus(
        tooth: Int,
        status: ToothStatusView?,
    ) {
        val current = model ?: return
        val statuses = if (status == null) current.statuses - tooth else current.statuses + (tooth to status)
        publish(current.copy(statuses = statuses))
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
