package com.aarogyam.staff.chart

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.addProcedure
import com.aarogyam.staff.api.model.NewProcedure
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.outbox.Queued
import com.aarogyam.staff.outbox.WriteQueue
import com.aarogyam.staff.outbox.shouldQueue
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The Add treatment form for the picked tooth (or group), as in the founder's design. */
data class TreatmentFormState(
    val status: TreatmentStatus = TreatmentStatus.Completed,
    val treatment: TermView? = null,
    val surfaces: Set<Surface> = emptySet(),
    val material: TermView? = null,
    val note: String = "",
    /** The history entry being corrected, when the form was opened with Edit. */
    val editing: HistoryEntryView? = null,
    val saving: Boolean = false,
    val error: ScreenError? = null,
    /** Set when the last save went through; the sheet closes. */
    val saved: Boolean = false,
    /** The procedure is saved on this phone and not yet on the server ("Saved, will send"). */
    val pendingSync: Boolean = false,
    /** What Save would do, or why it cannot. */
    val check: TreatmentCheck = TreatmentCheck.Blocked(TreatmentBlock.NoTreatment),
)

/**
 * The tooth sheet's Add treatment form. A completed treatment draws its finding through [chart]
 * (which shows it at once and takes it back if refused); inside [visitId] it is also logged as a
 * visit procedure, and Planned is only that. Watch records a watch finding.
 */
class ToothSheetStateHolder(
    private val clinic: ClinicContext,
    private val chart: ChartStateHolder,
    private val visitId: String?,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.toothsheet"),
    /** Saves a procedure for later when offline; null keeps it online-only. */
    private val writes: WriteQueue? = null,
) {
    private val mutableForm = MutableStateFlow(TreatmentFormState().checked())
    val form: StateFlow<TreatmentFormState> = mutableForm.asStateFlow()
    private val queuedIds = mutableSetOf<String>()

    init {
        writes?.let { w ->
            scope.launch {
                w.runner.ids.collect { ids ->
                    val waiting = queuedIds.any { it in ids }
                    mutableForm.update { if (it.pendingSync == waiting) it else it.copy(pendingSync = waiting) }
                }
            }
        }
    }

    fun setStatus(status: TreatmentStatus) = edit { it.copy(status = status) }

    fun chooseTreatment(term: TermView?) = edit { it.copy(treatment = term) }

    fun toggleSurface(surface: Surface) =
        edit {
            it.copy(
                surfaces =
                    if (surface in
                        it.surfaces
                    ) {
                        it.surfaces - surface
                    } else {
                        it.surfaces + surface
                    },
            )
        }

    fun chooseMaterial(term: TermView?) = edit { it.copy(material = term) }

    fun setNote(text: String) = edit { it.copy(note = text.take(MAX_NOTE)) }

    /** Opens the form on [entry] to correct it; the same surface supersedes it as usual. */
    fun startEdit(
        entry: HistoryEntryView,
        terms: List<TermView>,
    ) = edit {
        TreatmentFormState(
            status = if (entry.finding == Finding.Watch) TreatmentStatus.Watch else TreatmentStatus.Completed,
            treatment = terms.firstOrNull { t -> t.kind == TermKind.Procedure && t.label == entry.procedure },
            surfaces = setOfNotNull(entry.surface),
            material = terms.firstOrNull { t -> t.kind == TermKind.Material && t.label == entry.material },
            note = entry.note.orEmpty(),
            editing = entry,
        )
    }

    fun reset() = mutableForm.update { TreatmentFormState(pendingSync = it.pendingSync).checked() }

    fun save(tooth: Int) {
        val f = mutableForm.value
        val plan = (f.check as? TreatmentCheck.Ok)?.plan ?: return
        if (f.saving) return
        val surfaces = f.surfaces.sortedBy { it.ordinal }
        plan.finding?.let { chart.record(it, surfaces, f.treatment, f.material, f.note) }
        val status = plan.procedureStatus
        val visit = visitId
        if (status == null || visit == null || f.treatment == null) {
            mutableForm.update { it.copy(saved = true) }
            return
        }
        mutableForm.update { it.copy(saving = true, error = null) }
        scope.launch {
            val body =
                NewProcedure(
                    name = f.treatment.label,
                    tooth = tooth.toLong(),
                    surfaces = surfaces.map { it.name }.ifEmpty { null },
                    note = f.note.trim().ifEmpty { null },
                    status = status,
                )
            if (writes != null && !writes.online) return@launch queue(writes, visit, body)
            when (val answer = clinic.api.addProcedure(visit, body)) {
                is Outcome.Success -> {
                    log.info("visit.procedure_added") { id("visit", visit) }
                    mutableForm.update { it.copy(saving = false, saved = true) }
                }

                is Outcome.Failure -> {
                    if (writes != null && answer.error.shouldQueue()) return@launch queue(writes, visit, body)
                    log.warn("visit.procedure_failed") {
                        id("visit", visit)
                        code("error", answer.error.code.value)
                    }
                    mutableForm.update { it.copy(saving = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    /** Saves the procedure on the phone; the sheet closes and shows it as waiting to send. */
    private fun queue(
        w: WriteQueue,
        visit: String,
        body: NewProcedure,
    ) {
        when (val queued = w.procedure(clinic.slug, visit, body)) {
            is Queued.Saved -> {
                queuedIds += queued.id
                mutableForm.update { it.copy(saving = false, saved = true, pendingSync = true) }
            }

            is Queued.Refused -> {
                log.warn("visit.procedure_not_saved") { code("why", queued.why.name) }
                mutableForm.update { it.copy(saving = false, error = ScreenError.Unknown) }
            }
        }
    }

    private fun edit(change: (TreatmentFormState) -> TreatmentFormState) =
        mutableForm.update { change(it).copy(saved = false, error = null).checked() }

    private fun TreatmentFormState.checked(): TreatmentFormState {
        val changed = editing?.surface?.let { s -> surfaces.isNotEmpty() && surfaces != setOf(s) } == true
        return copy(check = planTreatment(status, treatment, visitId != null, changed))
    }

    private companion object {
        const val MAX_NOTE = 1000
    }
}
