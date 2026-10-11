package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.Drug
import com.aarogyam.staff.api.model.RxValues
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.AllergyView
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Writing and issuing one prescription. Issuing is a draft (`createPrescription`, once), the issue
 * and then the share link (PIN). Allergies the patient already has on record warn while the doctor
 * picks; the doctor must give a reason to go ahead, and the clinic's own check decides at issue.
 */
class RxSheetStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val allergies: List<AllergyView>,
    private val scope: CoroutineScope,
    /** The open visit this prescription belongs to, from the Visit screen; null from Patient 360. */
    private val visitId: String? = null,
    private val log: Logger = Logger("aarogyam.rxsheet"),
) {
    private val mutableState =
        MutableStateFlow(RxSheetState(allowed = PRESCRIPTIONS_ISSUE in clinic.permissions))

    /** The sheet's state. */
    val state: StateFlow<RxSheetState> = mutableState.asStateFlow()

    private var searchJob: Job? = null
    private var nextKey = 0
    private val sync = RxDraftSync(clinic, patientId, visitId)
    private var frozen = false

    /** Searches the catalogue as the doctor types. */
    fun search(query: String) {
        if (!mutableState.value.allowed) return
        searchJob?.cancel()
        mutableState.update { it.copy(query = query, error = null) }
        val text = query.trim()
        if (text.isEmpty()) {
            mutableState.update { it.copy(results = emptyList(), searching = false) }
            return
        }
        mutableState.update { it.copy(searching = true) }
        searchJob =
            scope.launch {
                delay(SEARCH_DEBOUNCE_MS)
                when (val result = clinic.api.searchDrugs(text)) {
                    is Outcome.Success -> {
                        mutableState.update {
                            it.copy(
                                results = result.value.items.map(Drug::toView),
                                searching = false,
                            )
                        }
                    }

                    is Outcome.Failure -> {
                        log.warn("rxsheet.search_failed") { code("error", result.error.code.value) }
                        mutableState.update {
                            it.copy(results = emptyList(), searching = false, error = ScreenError.of(result.error))
                        }
                    }
                }
            }
    }

    /** Adds [drug] with the catalogue's usual dose, frequency and days. */
    fun add(drug: DrugView) {
        if (!editable()) return
        val line =
            RxLine(
                key = nextKey++,
                drugId = drug.id,
                name = drug.name,
                detail = listOfNotNull(drug.strength, drug.form).joinToString(" "),
                dose = drug.defaultDose,
                frequency = drug.defaultFrequency,
                durationDays = drug.defaultDays ?: DEFAULT_DAYS,
                timing = drug.defaultTiming,
            )
        mutableState.update {
            recompute(
                it.copy(
                    draft = dirty(it),
                    lines = it.lines + line,
                    query = "",
                    results = emptyList(),
                    searching = false,
                ),
            )
        }
    }

    fun remove(key: Int) {
        if (!editable()) return
        mutableState.update {
            recompute(
                it.copy(
                    draft = dirty(it),
                    lines =
                        it.lines.filterNot { line ->
                            line.key == key
                        },
                ),
            )
        }
    }

    fun setDose(
        key: Int,
        dose: String,
    ) = change(key) { it.copy(dose = dose) }

    fun setFrequency(
        key: Int,
        frequency: String,
    ) = change(key) { it.copy(frequency = frequency) }

    fun setDuration(
        key: Int,
        days: Int,
    ) = change(key) { it.copy(durationDays = days.coerceIn(1, MAX_DAYS)) }

    /** The dose cells (morning, afternoon, night) become the line's frequency text, e.g. "1-0-1". */
    fun setDose(
        key: Int,
        dose: RxDose,
    ) = change(key) { it.copy(frequency = dose.format()) }

    /** Timing chip; null clears it. */
    fun setTiming(
        key: Int,
        timing: RxTiming?,
    ) = change(key) { it.copy(timing = timing?.api) }

    fun setDays(
        key: Int,
        days: Int,
    ) = setDuration(key, days)

    /**
     * Keeps what is on screen as a server draft (created once, then edited), so it can be issued
     * later. Lines stay editable; a change after saving marks the draft unsaved again.
     */
    fun saveDraft() {
        val current = mutableState.value
        if (!current.allowed || current.phase != RxPhase.Composing || current.lines.isEmpty()) return
        if (current.draft == DraftSave.Saving) return
        mutableState.update { it.copy(draft = DraftSave.Saving, error = null) }
        scope.launch {
            when (val result = sync.push(mutableState.value.lines)) {
                is Outcome.Success -> {
                    log.info("rxsheet.draft_saved") { id("prescription", result.value) }
                    mutableState.update { it.copy(draft = DraftSave.Saved) }
                }

                is Outcome.Failure -> {
                    log.warn("rxsheet.draft_failed") { code("error", result.error.code.value) }
                    mutableState.update { it.copy(draft = DraftSave.Failed, error = ScreenError.of(result.error)) }
                }
            }
        }
    }

    fun setOverrideReason(text: String) {
        // Still allowed once the draft exists: the clinic's own check may ask for the reason late.
        if (mutableState.value.let { it.allowed && it.phase == RxPhase.Composing }) {
            mutableState.update { it.copy(overrideReason = text.take(MAX_REASON)) }
        }
    }

    /** Quick Rx: starts from the patient's last issued prescription. */
    fun quickRx() {
        if (!editable() || CLINICAL_READ !in clinic.permissions) return
        mutableState.update { it.copy(error = null) }
        scope.launch {
            when (val result = clinic.api.lastPrescription(patientId)) {
                is Outcome.Success -> {
                    val lines = result.value.items.mapNotNull { it.toLine(nextKey++) }
                    mutableState.update { recompute(it.copy(lines = lines)) }
                }

                is Outcome.Failure -> {
                    log.info("rxsheet.quick_rx_unavailable") { code("error", result.error.code.value) }
                    mutableState.update { it.copy(error = ScreenError.of(result.error)) }
                }
            }
        }
    }

    /** Drafts (once), issues and then creates the share link. Shows what went wrong; a retry resumes. */
    fun issue() {
        val current = mutableState.value
        if (!current.canIssue) return
        frozen = true
        mutableState.update { it.copy(phase = RxPhase.Issuing, error = null) }
        scope.launch {
            val id = sync.id ?: createDraft() ?: return@launch
            val reason = current.overrideReason.trim().takeIf { current.needsOverride }
            when (val result = clinic.api.issuePrescription(id, reason)) {
                is Outcome.Success -> {
                    log.info("rxsheet.issued") { id("prescription", id) }
                    mutableState.update {
                        it.copy(
                            phase = RxPhase.Issued,
                            issued = IssuedRx(id, result.value.number, clinic.session.clinic.name),
                        )
                    }
                    share()
                }

                is Outcome.Failure -> {
                    val blocked = result.error.body
                    if (blocked != null && blocked.code == ALLERGY_ALERTS) {
                        log.info("rxsheet.allergy_alert") { id("prescription", id) }
                        val alerts = blocked.alerts.map { ServerAlert(severityOf(it.severity), it.message) }
                        mutableState.update {
                            it.copy(phase = RxPhase.Composing, serverAlert = true, serverAlerts = alerts)
                        }
                    } else {
                        fail(result.error.error)
                    }
                }
            }
        }
    }

    /**
     * Sends an already issued prescription again (Visit detail): opens the delivery step for [id] and
     * makes a fresh link and PIN. Does nothing while composing or once a prescription is set.
     */
    fun shareIssued(
        id: String,
        number: String?,
    ) {
        val current = mutableState.value
        if (current.issued != null || current.phase != RxPhase.Composing || current.lines.isNotEmpty()) return
        frozen = true
        mutableState.update {
            it.copy(phase = RxPhase.Issued, issued = IssuedRx(id, number, clinic.session.clinic.name))
        }
        share()
    }

    /** Creates the patient's link and PIN for the issued prescription; call again after a failure. */
    fun share() {
        val issued = mutableState.value.issued ?: return
        if (mutableState.value.share is ShareState.Creating) return
        mutableState.update { it.copy(share = ShareState.Creating) }
        scope.launch {
            when (val result = shareView(clinic, issued.id)) {
                is Outcome.Success -> {
                    mutableState.update { it.copy(share = ShareState.Ready(result.value)) }
                }

                is Outcome.Failure -> {
                    log.warn("rxsheet.share_failed") {
                        id("prescription", issued.id)
                        code("error", result.error.code.value)
                    }
                    mutableState.update { it.copy(share = ShareState.Failed(ScreenError.of(result.error))) }
                }
            }
        }
    }

    private suspend fun createDraft(): String? =
        when (val result = sync.push(mutableState.value.lines)) {
            is Outcome.Success -> {
                result.value
            }

            is Outcome.Failure -> {
                fail(result.error)
                null
            }
        }

    private fun fail(error: ApiError) {
        log.warn("rxsheet.issue_failed") {
            id("patient", patientId)
            code("error", error.code.value)
        }
        mutableState.update { it.copy(phase = RxPhase.Composing, error = ScreenError.of(error)) }
    }

    /** Lines are frozen once a draft exists on the server; a retry only resumes. */
    private fun editable(): Boolean {
        val state = mutableState.value
        return state.allowed && state.phase == RxPhase.Composing && !frozen
    }

    private fun change(
        key: Int,
        edit: (RxLine) -> RxLine,
    ) {
        if (editable()) {
            mutableState.update {
                it.copy(
                    draft = dirty(it),
                    lines =
                        it.lines.map { line ->
                            if (line.key ==
                                key
                            ) {
                                edit(line)
                            } else {
                                line
                            }
                        },
                )
            }
        }
    }

    private fun dirty(state: RxSheetState) = if (state.draft == DraftSave.Saved) DraftSave.None else state.draft

    private fun recompute(state: RxSheetState): RxSheetState =
        state.copy(warnings = warningsFor(state.lines, allergies))

    private companion object {
        const val SEARCH_DEBOUNCE_MS = 250L
        const val DEFAULT_DAYS = 5
        const val MAX_DAYS = 365
        const val MAX_REASON = 500
    }
}
