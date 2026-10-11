package com.aarogyam.staff.patients

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.clinic.ClinicContext
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

/**
 * The patient page's Overview tab and header money strip. The chart is read with the same request
 * and mapping the Chart tab uses; then visits, flags and files, and (with `billing.read`) the
 * bills, are read in parallel. A part the role may not read (403) is left empty; any other
 * failure fails the screen, or sets `error` when something is already shown.
 */
class PatientOverviewStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.overview"),
) {
    private val canSeeMoney = BILLING_READ in clinic.permissions
    private var moneyShown = false
    private val mutableState = MutableStateFlow<OverviewState>(OverviewState.Loading)

    /** The current tab state. */
    val state: StateFlow<OverviewState> = mutableState.asStateFlow()

    init {
        if (CLINICAL_READ in clinic.permissions) refresh() else mutableState.value = OverviewState.NotAllowed
    }

    /** Reloads, keeping what is on screen until the answer arrives. */
    fun refresh() {
        val current = mutableState.value
        when {
            current == OverviewState.NotAllowed -> {
                return
            }

            current is OverviewState.Loaded -> {
                if (current.refreshing) {
                    return
                } else {
                    mutableState.value =
                        current.copy(refreshing = true, error = null)
                }
            }

            else -> {
                mutableState.value = OverviewState.Loading
            }
        }
        scope.launch {
            when (val result = load()) {
                is Outcome.Success -> {
                    mutableState.value = result.value
                }

                is Outcome.Failure -> {
                    log.warn("overview.load_failed") {
                        id("patient", patientId)
                        code("error", result.error.code.value)
                    }
                    val error = ScreenError.of(result.error)
                    mutableState.value =
                        if (current is OverviewState.Loaded) {
                            current.copy(
                                refreshing = false,
                                error = error,
                            )
                        } else {
                            OverviewState.Failed(error)
                        }
                }
            }
        }
    }

    /** Shows or hides the amounts. Not saved: every new holder starts hidden. No-op without money. */
    fun toggleMoney() {
        val current = mutableState.value as? OverviewState.Loaded ?: return
        if (current.money == null) return
        moneyShown = !moneyShown
        mutableState.value = current.copy(moneyShown = moneyShown)
    }

    private suspend fun load(): Outcome<OverviewState.Loaded, ApiError> =
        coroutineScope {
            val chart = async { clinic.api.dentalChart(patientId) }
            val flags = async { clinic.api.clinicalFlags(patientId) }
            val visits = async { clinic.api.visits(patientId) }
            val files = async { clinic.api.attachments(patientId) }
            val bills = async { if (canSeeMoney) clinic.api.invoices(patientId) else null }
            val c = chart.await()
            val f = flags.await()
            val v = visits.await().listOrEmpty { it.items }
            val a = files.await().listOrEmpty { it.items }
            val b = bills.await()?.listOrEmpty { it.items }
            val zone = clinic.timeZone
            when {
                c is Outcome.Failure -> {
                    c
                }

                f is Outcome.Failure -> {
                    f
                }

                v is Outcome.Failure -> {
                    v
                }

                a is Outcome.Failure -> {
                    a
                }

                b is Outcome.Failure -> {
                    b
                }

                else -> {
                    val visitList = (v as Outcome.Success).value
                    Outcome.Success(
                        OverviewState.Loaded(
                            treatments = treatmentsOf((c as Outcome.Success).value.current, zone),
                            alerts = flagsOf((f as Outcome.Success).value),
                            lastVisit = lastVisitOf(visitList, zone),
                            media = mediaOf((a as Outcome.Success).value, zone).take(RECENT_MEDIA),
                            money = (b as Outcome.Success?)?.let { moneyOf(it.value, visitList.size) },
                            moneyShown = moneyShown,
                        ),
                    )
                }
            }
        }

    private companion object {
        const val CLINICAL_READ = "clinical.read"
        const val BILLING_READ = "billing.read"
        const val RECENT_MEDIA = 12
    }
}

/** The mapped list; a 403 is an empty list (the role may not read that part), other failures stay failures. */
private inline fun <T, R> Outcome<T, ApiError>.listOrEmpty(pick: (T) -> List<R>): Outcome<List<R>, ApiError> =
    when (this) {
        is Outcome.Success -> Outcome.Success(pick(value))
        is Outcome.Failure -> if (error.kind == ApiErrorKind.Forbidden) Outcome.Success(emptyList()) else this
    }
