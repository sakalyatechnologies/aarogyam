package com.aarogyam.staff.history

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.visit
import com.aarogyam.staff.clinic.ClinicContext
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

/** What the visit sheet draws. */
sealed interface VisitDetailState {
    data object Loading : VisitDetailState

    /** The role lacks `patients.read`; nothing was requested. */
    data object NotAllowed : VisitDetailState

    data class Failed(
        val error: ScreenError,
    ) : VisitDetailState

    data class Loaded(
        val view: VisitDetailView,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    ) : VisitDetailState
}

/**
 * One past visit. Three requests in parallel: `GET /visits/{id}` (the visit, its notes,
 * procedures and files), and the prescription and bill whose `encounter_id` is this visit, from
 * `GET /patients/{id}/prescriptions` (skipped without `clinical.read`) and
 * `GET /invoices?patient_id=` (skipped without `billing.read`, so the assistant never receives
 * money). A refused join leaves that card out; a visit without a prescription or bill has none.
 */
class VisitDetailStateHolder(
    private val clinic: ClinicContext,
    private val visitId: String,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.visit_detail"),
) {
    private val mutableState = MutableStateFlow<VisitDetailState>(VisitDetailState.Loading)

    /** The current screen state. */
    val state: StateFlow<VisitDetailState> = mutableState.asStateFlow()

    private val money = BILLING_READ in clinic.permissions

    init {
        if (PATIENTS_READ in clinic.permissions) refresh() else mutableState.value = VisitDetailState.NotAllowed
    }

    /** Reloads, keeping what is on screen until the answer arrives. */
    fun refresh() {
        val current = mutableState.value
        if (current is VisitDetailState.NotAllowed || (current as? VisitDetailState.Loaded)?.refreshing == true) return
        mutableState.value =
            if (current is VisitDetailState.Loaded) {
                current.copy(refreshing = true, error = null)
            } else {
                VisitDetailState.Loading
            }
        scope.launch {
            mutableState.value =
                when (val result = load()) {
                    is Outcome.Success -> {
                        VisitDetailState.Loaded(result.value)
                    }

                    is Outcome.Failure -> {
                        log.warn("visit_detail.load_failed") {
                            id("visit", visitId)
                            code("error", result.error.code.value)
                        }
                        val error = ScreenError.of(result.error)
                        if (current is VisitDetailState.Loaded) {
                            current.copy(refreshing = false, error = error)
                        } else {
                            VisitDetailState.Failed(error)
                        }
                    }
                }
        }
    }

    private suspend fun load(): Outcome<VisitDetailView, ApiError> =
        coroutineScope {
            val detail = async { clinic.api.visit(visitId) }
            val rx = async { if (CLINICAL_READ in clinic.permissions) clinic.api.prescriptions(patientId) else null }
            val bills = async { if (money) clinic.api.invoices(patientId) else null }
            val d = detail.await()
            val r = rx.await().optional()
            val b = bills.await().optional()
            when {
                d is Outcome.Failure -> {
                    d
                }

                r is Outcome.Failure -> {
                    r
                }

                b is Outcome.Failure -> {
                    b
                }

                d is Outcome.Success && r is Outcome.Success && b is Outcome.Success -> {
                    val v = d.value
                    Outcome.Success(
                        toDetailView(
                            v.visit,
                            v.notes,
                            v.procedures,
                            v.attachments,
                            r.value?.items.forVisit(visitId),
                            b.value?.items.forVisit(visitId),
                            money,
                            clinic.timeZone,
                        ),
                    )
                }

                else -> {
                    error("unreachable")
                }
            }
        }
}
