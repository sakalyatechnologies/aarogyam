package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.Drug
import com.aarogyam.staff.api.model.RxItem
import com.aarogyam.staff.api.model.RxValues
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.AllergyView
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.Severity
import com.aarogyam.staff.today.parseInstant
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
import kotlinx.datetime.toLocalDateTime

/** Quick choices for a medicine line; codes the doctor writes, not copy. */
object RxPresets {
    val doses: List<String> = listOf("1 tablet", "2 tablets", "5 ml", "10 ml")
    val frequencies: List<String> = listOf("1-0-0", "0-1-0", "0-0-1", "1-0-1", "1-1-1", "SOS")
    val durations: List<Int> = listOf(3, 5, 7, 10, 14)
}

/** A medicine from the catalogue. */
data class DrugView(
    val id: String,
    val name: String,
    val brand: String?,
    val strength: String,
    val form: String,
    val defaultDose: String,
    val defaultFrequency: String,
    val defaultDays: Int?,
    val defaultTiming: String?,
)

/** One medicine on the prescription being written. [key] is stable while the line is on screen. */
data class RxLine(
    val key: Int,
    val drugId: String?,
    val name: String,
    val detail: String,
    val dose: String,
    val frequency: String,
    val durationDays: Int,
    val timing: String?,
)

/**
 * One alert from the clinic's own allergy check, as the server worded it: [message] names the
 * medicine and the recorded allergy (clinical text: show it, never log it).
 */
data class ServerAlert(
    val severity: Severity,
    val message: String,
)

/** A medicine whose name matches a recorded allergy. */
data class AllergyWarning(
    val lineKey: Int,
    val drug: String,
    val substance: String,
    val severity: Severity,
)

enum class RxPhase { Composing, Issuing, Issued }

data class IssuedRx(
    val id: String,
    val number: String?,
    val clinicName: String,
)

/** The patient's link and PIN. The PIN is shown once and never goes into the shared text. */
data class ShareView(
    val url: String,
    val pin: String,
    val expiresAt: ClinicMoment?,
)

sealed interface ShareState {
    data object Creating : ShareState

    data class Ready(
        val link: ShareView,
    ) : ShareState

    data class Failed(
        val error: ScreenError,
    ) : ShareState
}

data class RxSheetState(
    /** False when the role lacks `prescriptions.issue`; nothing is requested then. */
    val allowed: Boolean = true,
    val query: String = "",
    val results: List<DrugView> = emptyList(),
    val searching: Boolean = false,
    val lines: List<RxLine> = emptyList(),
    /** Local match of the lines against the patient's recorded allergies. */
    val warnings: List<AllergyWarning> = emptyList(),
    /** The clinic's own allergy check stopped the issue (it also knows drug classes). */
    val serverAlert: Boolean = false,
    /** What the clinic's check said; empty when it stopped the issue without a readable body. */
    val serverAlerts: List<ServerAlert> = emptyList(),
    val overrideReason: String = "",
    val phase: RxPhase = RxPhase.Composing,
    val error: ScreenError? = null,
    val issued: IssuedRx? = null,
    val share: ShareState? = null,
) {
    /** Issuing needs an override reason while any allergy alert stands. */
    val needsOverride: Boolean get() = warnings.isNotEmpty() || serverAlert

    val canIssue: Boolean
        get() =
            allowed &&
                phase == RxPhase.Composing &&
                lines.isNotEmpty() &&
                (!needsOverride || overrideReason.trim().length >= MIN_REASON)

    internal companion object {
        const val MIN_REASON = 3
    }
}

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
    private val log: Logger = Logger("aarogyam.rxsheet"),
) {
    private val mutableState =
        MutableStateFlow(RxSheetState(allowed = PRESCRIPTIONS_ISSUE in clinic.permissions))

    /** The sheet's state. */
    val state: StateFlow<RxSheetState> = mutableState.asStateFlow()

    private var searchJob: Job? = null
    private var nextKey = 0
    private var draftId: String? = null

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
            recompute(it.copy(lines = it.lines + line, query = "", results = emptyList(), searching = false))
        }
    }

    fun remove(key: Int) {
        if (!editable()) return
        mutableState.update { recompute(it.copy(lines = it.lines.filterNot { line -> line.key == key })) }
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
        mutableState.update { it.copy(phase = RxPhase.Issuing, error = null) }
        scope.launch {
            val id = draftId ?: createDraft() ?: return@launch
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

    /** Creates the patient's link and PIN for the issued prescription; call again after a failure. */
    fun share() {
        val issued = mutableState.value.issued ?: return
        if (mutableState.value.share is ShareState.Creating) return
        mutableState.update { it.copy(share = ShareState.Creating) }
        scope.launch {
            when (val result = clinic.api.sharePrescription(issued.id)) {
                is Outcome.Success -> {
                    val link = result.value
                    val view =
                        ShareView(
                            url = "${clinic.api.origin}/shared/${link.token}",
                            pin = link.pin,
                            expiresAt =
                                parseInstant(
                                    link.expiresAt,
                                )?.toLocalDateTime(clinic.timeZone)?.let { ClinicMoment(it.date, it.time) },
                        )
                    mutableState.update { it.copy(share = ShareState.Ready(view)) }
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

    private suspend fun createDraft(): String? {
        val items = mutableState.value.lines.map { it.toItem() }
        return when (val result = clinic.api.createPrescription(patientId, RxValues(items = items))) {
            is Outcome.Success -> {
                result.value.id.also { draftId = it }
            }

            is Outcome.Failure -> {
                fail(result.error)
                null
            }
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
        return state.allowed && state.phase == RxPhase.Composing && draftId == null
    }

    private fun change(
        key: Int,
        edit: (RxLine) -> RxLine,
    ) {
        if (editable()) {
            mutableState.update {
                it.copy(
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

    private fun recompute(state: RxSheetState): RxSheetState =
        state.copy(warnings = warningsFor(state.lines, allergies))

    private companion object {
        const val SEARCH_DEBOUNCE_MS = 250L
        const val DEFAULT_DAYS = 5
        const val MAX_DAYS = 365
        const val MAX_REASON = 500
    }
}

private fun Drug.toView() =
    DrugView(
        id = id,
        name = genericName,
        brand = brandName,
        strength = strength,
        form = form,
        defaultDose = defaultDose,
        defaultFrequency = defaultFrequency,
        defaultDays = defaultDurationDays,
        defaultTiming = defaultTiming,
    )

private fun RxLine.toItem() =
    RxItem(
        drugId = drugId,
        drugName = if (drugId == null) name else null,
        dose = dose,
        frequency = frequency,
        durationDays = durationDays,
        timing = timing,
    )

private fun RxItem.toLine(key: Int): RxLine? {
    val name = drugName?.takeIf { it.isNotBlank() } ?: return null
    return RxLine(
        key = key,
        drugId = drugId,
        name = name,
        detail = listOfNotNull(strength, form).joinToString(" "),
        dose = dose.orEmpty(),
        frequency = frequency.orEmpty(),
        durationDays = durationDays ?: 5,
        timing = timing,
    )
}

/** Name matches only (the clinic's check also knows classes such as penicillins). */
internal fun warningsFor(
    lines: List<RxLine>,
    allergies: List<AllergyView>,
): List<AllergyWarning> =
    lines.flatMap { line ->
        val drug = line.name.lowercase()
        allergies.mapNotNull { allergy ->
            val substance = allergy.substance.trim().lowercase()
            val matches = substance.length >= 3 && (drug.contains(substance) || substance.contains(drug))
            if (matches) AllergyWarning(line.key, line.name, allergy.substance.trim(), allergy.severity) else null
        }
    }

private const val ALLERGY_ALERTS = "allergy_alerts"

/** The API's alert severity: `info`, `caution` or `serious`. */
private fun severityOf(text: String): Severity =
    when (text) {
        "serious" -> Severity.Severe
        "caution" -> Severity.Moderate
        "info" -> Severity.Mild
        else -> Severity.Unknown
    }
