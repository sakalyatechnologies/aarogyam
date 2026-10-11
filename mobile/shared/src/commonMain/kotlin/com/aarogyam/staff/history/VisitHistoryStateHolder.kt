package com.aarogyam.staff.history

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.Invoice
import com.aarogyam.staff.api.model.Prescription
import com.aarogyam.staff.api.model.Visit
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.moment
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The bill of a visit as the list shows it; [None] also covers a role without `billing.read`. */
enum class BillState { Paid, Due, None }

/**
 * One line of the History tab. [hasNotes] and [hasPhotos] are null: the list calls don't carry
 * them (the visit detail does), so the list never guesses.
 */
data class VisitRow(
    val id: String,
    val number: String,
    val at: ClinicMoment,
    val clinician: String,
    val title: String?,
    val hasNotes: Boolean?,
    val hasRx: Boolean,
    val hasPhotos: Boolean?,
    val bill: BillState,
    val open: Boolean,
)

/** What the History tab draws. */
sealed interface VisitHistoryState {
    data object Loading : VisitHistoryState

    /** The role lacks `patients.read`; nothing was requested. */
    data object NotAllowed : VisitHistoryState

    data class Failed(
        val error: ScreenError,
    ) : VisitHistoryState

    /** [rows] are newest first; [moneyVisible] is false without `billing.read` (every bill is [BillState.None]). */
    data class Loaded(
        val rows: List<VisitRow>,
        val moneyVisible: Boolean,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    ) : VisitHistoryState
}

/**
 * A patient's visit list. Three requests in parallel, no more: `GET /patients/{id}/visits`, and
 * the joins by `encounter_id` from `GET /patients/{id}/prescriptions` (skipped without
 * `clinical.read`) and `GET /invoices?patient_id=` (skipped without `billing.read`). A refused
 * join leaves its flag empty instead of failing the tab.
 */
class VisitHistoryStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.history"),
) {
    private val mutableState = MutableStateFlow<VisitHistoryState>(VisitHistoryState.Loading)

    /** The current screen state. */
    val state: StateFlow<VisitHistoryState> = mutableState.asStateFlow()

    private val money = BILLING_READ in clinic.permissions

    init {
        if (PATIENTS_READ in clinic.permissions) refresh() else mutableState.value = VisitHistoryState.NotAllowed
    }

    /** Reloads, keeping what is on screen until the answer arrives. */
    fun refresh() {
        val current = mutableState.value
        if (current is VisitHistoryState.NotAllowed ||
            (current as? VisitHistoryState.Loaded)?.refreshing == true
        ) {
            return
        }
        mutableState.value =
            if (current is VisitHistoryState.Loaded) {
                current.copy(refreshing = true, error = null)
            } else {
                VisitHistoryState.Loading
            }
        scope.launch {
            mutableState.value =
                when (val result = load()) {
                    is Outcome.Success -> {
                        VisitHistoryState.Loaded(result.value, money)
                    }

                    is Outcome.Failure -> {
                        log.warn("history.load_failed") {
                            id("patient", patientId)
                            code("error", result.error.code.value)
                        }
                        val error = ScreenError.of(result.error)
                        if (current is VisitHistoryState.Loaded) {
                            current.copy(refreshing = false, error = error)
                        } else {
                            VisitHistoryState.Failed(error)
                        }
                    }
                }
        }
    }

    private suspend fun load(): Outcome<List<VisitRow>, ApiError> =
        coroutineScope {
            val visits = async { clinic.api.visits(patientId) }
            val rx = async { if (CLINICAL_READ in clinic.permissions) clinic.api.prescriptions(patientId) else null }
            val bills = async { if (money) clinic.api.invoices(patientId) else null }
            val v = visits.await()
            val r = rx.await().optional()
            val b = bills.await().optional()
            when {
                v is Outcome.Failure -> {
                    v
                }

                r is Outcome.Failure -> {
                    r
                }

                b is Outcome.Failure -> {
                    b
                }

                v is Outcome.Success && r is Outcome.Success && b is Outcome.Success -> {
                    Outcome.Success(rows(v.value.items, r.value?.items, b.value?.items))
                }

                else -> {
                    error("unreachable")
                }
            }
        }

    private fun rows(
        visits: List<Visit>,
        prescriptions: List<Prescription>?,
        invoices: List<Invoice>?,
    ): List<VisitRow> =
        visits
            .mapNotNull { visit -> parseInstant(visit.startedAt)?.let { it to visit } }
            .sortedByDescending { it.first }
            .mapNotNull { (_, visit) ->
                moment(visit.startedAt, clinic.timeZone)?.let { at ->
                    VisitRow(
                        id = visit.id,
                        number = visit.number,
                        at = at,
                        clinician = visit.clinician.name,
                        title = visit.chiefComplaint,
                        hasNotes = null,
                        hasRx = prescriptions.forVisit(visit.id) != null,
                        hasPhotos = null,
                        bill = billState(invoices.forVisit(visit.id)),
                        open = visit.status == "open",
                    )
                }
            }

    private fun billState(invoice: Invoice?): BillState =
        when {
            invoice == null -> BillState.None
            invoice.paymentState == "paid" -> BillState.Paid
            else -> BillState.Due
        }
}
