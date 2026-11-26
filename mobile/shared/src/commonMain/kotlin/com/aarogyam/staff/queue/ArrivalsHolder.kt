package com.aarogyam.staff.queue

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.acceptArrival
import com.aarogyam.staff.api.arrivals
import com.aarogyam.staff.api.dismissArrival
import com.aarogyam.staff.api.intakeOptions
import com.aarogyam.staff.api.model.AcceptBody
import com.aarogyam.staff.api.model.Arrival
import com.aarogyam.staff.api.model.IntakeOptions
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.sexOf
import com.aarogyam.staff.walkin.DoctorOption
import com.aarogyam.staff.walkin.PhoneMatchRow
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * QR check-ins waiting at the desk (`GET /arrivals`), polled whenever the queue refreshes. The
 * desk picks a registered match or "New patient" per arrival, then adds to the queue or dismisses.
 */
class ArrivalsHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.arrivals"),
    /** Called after an arrival was handled, so the queue reloads. */
    private val onHandled: () -> Unit = {},
) {
    private val canRead = "patients.read" in clinic.permissions
    private val canAccept =
        listOf("patients.write", "appointments.write", "intake.write").all { it in clinic.permissions }
    private val mutable =
        MutableStateFlow<ArrivalsState>(
            if (canRead) ArrivalsState.Shown(canAccept = canAccept) else ArrivalsState.Hidden,
        )

    val state: StateFlow<ArrivalsState> = mutable.asStateFlow()

    /** Reads the waiting arrivals again; a failed poll keeps what is shown. */
    fun refresh() {
        if (!canRead) return
        scope.launch {
            if (canAccept && (mutable.value as? ArrivalsState.Shown)?.doctors.isNullOrEmpty()) loadDoctors()
            if (canAccept && options == null) options = (clinic.api.intakeOptions() as? Outcome.Success)?.value
            when (val result = clinic.api.arrivals()) {
                is Outcome.Success -> {
                    mutable.update { state ->
                        val s = shown(state)
                        s.copy(rows = result.value.items.map { it.toRow(s.rows, options) })
                    }
                }

                is Outcome.Failure -> {
                    log.warn("arrivals.load_failed") { code("error", result.error.code.value) }
                }
            }
        }
    }

    /** The words for the codes in an arrival's case-paper fields; loaded once, and the codes show until then. */
    private var options: IntakeOptions? = null

    private suspend fun loadDoctors() {
        val list =
            (clinic.reference.practitioners() as? Outcome.Success)
                ?.value
                ?.filter { it.active }
                ?.map { DoctorOption(it.id, it.displayName) }
                .orEmpty()
        mutable.update { shown(it).copy(doctors = list) }
    }

    /** Chooses [doctorId] for [id]; null means any doctor. */
    fun chooseDoctor(
        id: String,
        doctorId: String?,
    ) = editRow(id) { it.copy(chosenDoctorId = doctorId) }

    /** Chooses a registered match for [id], or "New patient" when [patientId] is null. */
    fun choose(
        id: String,
        patientId: String?,
    ) = editRow(id) { it.copy(chosenPatientId = patientId) }

    /** "Add to queue": the chosen match, or a new patient, joins the queue. */
    fun accept(
        id: String,
        practitionerId: String? = null,
    ) {
        val row = (mutable.value as? ArrivalsState.Shown)?.rows?.firstOrNull { it.id == id } ?: return
        if (!canAccept || !markBusy(id)) return
        scope.launch {
            val body =
                AcceptBody(
                    checkIn = true,
                    patientId = row.chosenPatientId,
                    practitionerId =
                        practitionerId ?: row.chosenDoctorId,
                )
            when (val result = clinic.api.acceptArrival(id, body)) {
                is Outcome.Success -> {
                    log.info("arrival.accepted") { id("arrival_id", id) }
                    remove(id)
                    onHandled()
                }

                is Outcome.Failure -> {
                    failed("arrivals.accept_failed", id, result.error)
                }
            }
        }
    }

    fun dismiss(id: String) {
        if (!markBusy(id)) return
        scope.launch {
            when (val result = clinic.api.dismissArrival(id)) {
                is Outcome.Success -> {
                    log.info("arrival.dismissed") { id("arrival_id", id) }
                    remove(id)
                }

                is Outcome.Failure -> {
                    failed("arrivals.dismiss_failed", id, result.error)
                }
            }
        }
    }

    /** Clears the notice or error once the screen showed it. */
    fun clearMessage() = mutable.update { if (it is ArrivalsState.Shown) it.copy(notice = null, error = null) else it }

    private fun failed(
        event: String,
        id: String,
        error: ApiError,
    ) {
        log.warn(event) { code("error", error.code.value) }
        if (error.code.value == ALREADY_HANDLED) {
            mutable.update {
                val s = shown(it)
                s.copy(rows = s.rows.filterNot { r -> r.id == id }, notice = ArrivalNotice.AlreadyHandled)
            }
            onHandled()
        } else {
            mutable.update {
                val s = shown(it)
                s.copy(
                    rows =
                        s.rows.map { r ->
                            if (r.id ==
                                id
                            ) {
                                r.copy(busy = false)
                            } else {
                                r
                            }
                        },
                    error = ScreenError.of(error),
                )
            }
        }
    }

    private fun remove(id: String) =
        mutable.update {
            val s = shown(it)
            s.copy(rows = s.rows.filterNot { r -> r.id == id }, notice = null, error = null)
        }

    private fun editRow(
        id: String,
        change: (ArrivalRow) -> ArrivalRow,
    ) = mutable.update {
        val s = shown(it)
        s.copy(rows = s.rows.map { r -> if (r.id == id) change(r) else r })
    }

    private fun markBusy(id: String): Boolean {
        var marked = false
        mutable.update { state ->
            val s = shown(state)
            val rows =
                s.rows.map {
                    if (it.id == id && !it.busy) {
                        marked = true
                        it.copy(busy = true)
                    } else {
                        it
                    }
                }
            s.copy(rows = rows, notice = null, error = null)
        }
        return marked
    }

    private fun shown(state: ArrivalsState): ArrivalsState.Shown =
        state as? ArrivalsState.Shown ?: ArrivalsState.Shown(canAccept = canAccept)

    private companion object {
        const val ALREADY_HANDLED = "already_handled"
    }
}

/** The row for this arrival; the desk's earlier choice and busy flag survive a refresh while the match is still there. */
internal fun Arrival.toRow(
    before: List<ArrivalRow>,
    options: IntakeOptions? = null,
): ArrivalRow {
    val found = matches.items.map { PhoneMatchRow(it.id, it.fullName, it.number, it.ageYears, sexOf(it.sex)) }
    val kin = matches.familyGroup.map { ArrivalRelative(it.id, it.fullName, it.number, it.relation) }
    val earlier = before.firstOrNull { it.id == id }
    return ArrivalRow(
        id = id,
        name = listOfNotNull(firstName, lastName).joinToString(" "),
        phone = phone,
        ageYears = ageYears,
        sex = sexOf(sex.orEmpty()),
        reasons = reasonLabels,
        matches = found,
        relatives = kin,
        chosenPatientId =
            earlier?.chosenPatientId?.takeIf { pick ->
                found.any { it.id == pick } ||
                    kin.any { it.id == pick }
            },
        chosenDoctorId = earlier?.chosenDoctorId,
        busy = earlier?.busy == true,
        intake = intakeSummary(options),
    )
}
