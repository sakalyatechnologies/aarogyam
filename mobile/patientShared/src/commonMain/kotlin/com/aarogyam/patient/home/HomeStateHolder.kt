package com.aarogyam.patient.home

import com.aarogyam.patient.AppointmentView
import com.aarogyam.patient.ClinicTime
import com.aarogyam.patient.ClinicView
import com.aarogyam.patient.PatientDirectory
import com.aarogyam.patient.ScreenError
import com.aarogyam.patient.view
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One clinic on the home screen. */
data class ClinicSummaryView(
    val clinic: ClinicView,
    val balancePaise: Long,
    val prescriptions: Int,
)

/** The home screen. */
data class HomeView(
    val next: AppointmentView?,
    val balancePaise: Long,
    val prescriptions: Int,
    val lastPrescription: ClinicTime?,
    val clinics: List<ClinicSummaryView>,
)

/** What the home screen draws. */
sealed interface HomeState {
    data object Loading : HomeState

    data class Failed(
        val error: ScreenError,
    ) : HomeState

    data class Loaded(
        val view: HomeView,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    ) : HomeState
}

/** The home screen: one `GET /me/patient/home` per load, every linked clinic at once. */
class HomeStateHolder(
    private val directory: PatientDirectory,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.patient.home"),
) {
    private val mutableState = MutableStateFlow<HomeState>(HomeState.Loading)

    /** The current screen state. */
    val state: StateFlow<HomeState> = mutableState.asStateFlow()

    init {
        refresh()
    }

    /** Reloads, keeping what is on screen until the answer arrives. */
    fun refresh() {
        val shown = mutableState.value as? HomeState.Loaded
        if (shown?.refreshing == true) return
        if (shown != null) mutableState.value = shown.copy(refreshing = true, error = null)
        scope.launch {
            val api =
                when (val found = directory.app()) {
                    is Outcome.Success -> found.value
                    is Outcome.Failure -> return@launch fail(ScreenError.of(found.error))
                }
            when (val home = api.home()) {
                is Outcome.Success -> {
                    val body = home.value
                    val names = body.clinics.associate { it.clinic.clinicId to it.clinic.name }
                    mutableState.value =
                        HomeState.Loaded(
                            HomeView(
                                next = body.nextAppointment?.view { names[it].orEmpty() },
                                balancePaise = body.balancePaise,
                                prescriptions = body.clinics.sumOf { it.prescriptions.toInt() },
                                lastPrescription =
                                    body.clinics
                                        .mapNotNull { it.lastPrescriptionAt }
                                        .maxOrNull()
                                        .let(ClinicTime::parse),
                                clinics =
                                    body.clinics.map {
                                        ClinicSummaryView(it.clinic.view(), it.balancePaise, it.prescriptions.toInt())
                                    },
                            ),
                        )
                }

                is Outcome.Failure -> {
                    log.warn("home.load_failed") { code("error", home.error.code.value) }
                    fail(ScreenError.of(home.error))
                }
            }
        }
    }

    private fun fail(error: ScreenError) {
        val shown = mutableState.value as? HomeState.Loaded
        mutableState.value = shown?.copy(refreshing = false, error = error) ?: HomeState.Failed(error)
    }
}
