package com.aarogyam.staff.history

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.Invoice
import com.aarogyam.staff.api.model.Prescription
import com.aarogyam.staff.api.model.Procedure
import com.aarogyam.staff.api.model.Visit
import com.aarogyam.staff.api.patientProcedures
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.moment
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.ApiErrorKind
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

/** How the visit began, for a title when it has no complaint and no procedure. */
enum class VisitKind { Appointment, WalkIn }

/**
 * What a card can be titled from, in this order: [complaint], else [firstProcedure], else [kind].
 * The words stay in the app's strings; the holder only says which source exists.
 */
data class VisitTitleSource(
    val complaint: String?,
    val firstProcedure: String?,
    /** Null when the source doesn't say (the `/history` cards don't carry the appointment link). */
    val kind: VisitKind?,
)

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
    /** Teeth (FDI) of the visit's procedures, ascending; empty when none or without `clinical.read`. */
    val teeth: List<Int> = emptyList(),
    /** Left to pay on the visit's bill; null without `billing.read` or when there is no bill, 0 when paid. */
    val duePaise: Long? = null,
    val titleSource: VisitTitleSource = VisitTitleSource(title, null, VisitKind.WalkIn),
    /** First line of the first signed note (120 characters at most); null when none or not loaded. */
    val noteLine: String? = null,
    /** Medicines prescribed in the visit, in order; empty on the fallback list. */
    val medicines: List<String> = emptyList(),
    val photoCount: Int = 0,
    /** Per-tooth work of the visit; empty on the fallback list, where only [teeth] is known. */
    val work: List<ToothWork> = emptyList(),
    val plans: List<VisitPlan> = emptyList(),
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
        /** Older visits wait behind this; null when everything is on screen. */
        val nextCursor: String? = null,
        val loadingMore: Boolean = false,
    ) : VisitHistoryState {
        val hasMore: Boolean get() = nextCursor != null
    }
}

/**
 * A patient's visit list. With `clinical.read`, one request: `GET /patients/{id}/history`, a page
 * at a time ([loadMore]). Without it, or against a server without that route (404), the older
 * path: three requests in parallel, no more: `GET /patients/{id}/visits`, and
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
                        VisitHistoryState.Loaded(result.value.rows, money, nextCursor = result.value.nextCursor)
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

    /** Appends the next page of older visits; does nothing when there is none or one is on its way. */
    fun loadMore() {
        val current = mutableState.value as? VisitHistoryState.Loaded ?: return
        val cursor = current.nextCursor ?: return
        if (current.loadingMore || current.refreshing) return
        mutableState.value = current.copy(loadingMore = true, error = null)
        scope.launch {
            val result = clinic.api.patientHistory(patientId, before = cursor)
            val now = mutableState.value as? VisitHistoryState.Loaded ?: return@launch
            mutableState.value =
                when (result) {
                    is Outcome.Success -> {
                        val known = now.rows.mapTo(HashSet()) { it.id }
                        val more =
                            result.value.visits
                                .mapNotNull {
                                    it.toRow(
                                        clinic.timeZone,
                                    )
                                }.filter { it.id !in known }
                        now.copy(rows = now.rows + more, nextCursor = result.value.nextCursor, loadingMore = false)
                    }

                    is Outcome.Failure -> {
                        log.warn("history.more_failed") {
                            id("patient", patientId)
                            code("error", result.error.code.value)
                        }
                        now.copy(loadingMore = false, error = ScreenError.of(result.error))
                    }
                }
        }
    }

    private suspend fun load(): Outcome<HistoryPage, ApiError> {
        if (CLINICAL_READ in clinic.permissions) {
            when (val page = clinic.api.patientHistory(patientId)) {
                is Outcome.Success -> {
                    val rows = page.value.visits.mapNotNull { it.toRow(clinic.timeZone) }
                    return Outcome.Success(HistoryPage(rows, page.value.nextCursor))
                }

                is Outcome.Failure -> {
                    if (page.error.kind != ApiErrorKind.NotFound) return page
                }
            }
        }
        return when (val rows = loadLegacy()) {
            is Outcome.Success -> Outcome.Success(HistoryPage(rows.value, null))
            is Outcome.Failure -> rows
        }
    }

    private suspend fun loadLegacy(): Outcome<List<VisitRow>, ApiError> =
        coroutineScope {
            val visits = async { clinic.api.visits(patientId) }
            val rx = async { if (CLINICAL_READ in clinic.permissions) clinic.api.prescriptions(patientId) else null }
            val bills = async { if (money) clinic.api.invoices(patientId) else null }
            // Teeth and titles only; a refusal or a failure here leaves them out instead of failing the tab.
            val procs =
                async {
                    if (CLINICAL_READ in
                        clinic.permissions
                    ) {
                        clinic.api.patientProcedures(patientId)
                    } else {
                        null
                    }
                }
            val v = visits.await()
            val r = rx.await().optional()
            val b = bills.await().optional()
            val procedures = (procs.await() as? Outcome.Success)?.value?.items
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
                    Outcome.Success(rows(v.value.items, r.value?.items, b.value?.items, procedures))
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
        procedures: List<Procedure>?,
    ): List<VisitRow> =
        visits
            .mapNotNull { visit -> parseInstant(visit.startedAt)?.let { it to visit } }
            .sortedByDescending { it.first }
            .mapNotNull { (_, visit) ->
                moment(visit.startedAt, clinic.timeZone)?.let { at ->
                    val mine = procedures.orEmpty().filter { it.visitId == visit.id && it.status != "entered_in_error" }
                    val invoice = invoices.forVisit(visit.id)
                    VisitRow(
                        id = visit.id,
                        number = visit.number,
                        at = at,
                        clinician = visit.clinician.name,
                        title = visit.chiefComplaint,
                        hasNotes = null,
                        hasRx = prescriptions.forVisit(visit.id) != null,
                        hasPhotos = null,
                        bill = billState(invoice),
                        open = visit.status == "open",
                        teeth =
                            mine
                                .mapNotNull { it.tooth }
                                .filter { it > 0 }
                                .distinct()
                                .sorted(),
                        duePaise = invoice?.balancePaise,
                        titleSource =
                            VisitTitleSource(
                                complaint = visit.chiefComplaint?.trim()?.takeIf { it.isNotEmpty() },
                                // The list is newest first; the first of the visit is the oldest.
                                firstProcedure =
                                    mine
                                        .lastOrNull()
                                        ?.name
                                        ?.trim()
                                        ?.takeIf { it.isNotEmpty() },
                                kind = if (visit.appointmentId != null) VisitKind.Appointment else VisitKind.WalkIn,
                            ),
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
