package com.aarogyam.patient.appointments

import com.aarogyam.patient.AppointmentView
import com.aarogyam.patient.PatientDirectory
import com.aarogyam.patient.ScreenError
import com.aarogyam.patient.view
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Why a cancellation didn't go through. */
enum class CancelError {
    /** Inside the clinic's notice, or already started: call the clinic. */
    TooLate,
    Failed,
}

/** What the appointments screen draws. */
sealed interface AppointmentsState {
    data object Loading : AppointmentsState

    data class Failed(
        val error: ScreenError,
    ) : AppointmentsState

    /** [cancelling] is the appointment being cancelled; [cancelError] the last failure. */
    data class Loaded(
        val upcoming: List<AppointmentView>,
        val past: List<AppointmentView>,
        val cancelling: String? = null,
        val cancelError: CancelError? = null,
    ) : AppointmentsState
}

/**
 * The patient's appointments at every linked clinic (`GET /me/patient/appointments`). Cancelling
 * goes to the appointment's clinic host (`POST /me/patient/appointments/{id}/cancel`), then reloads.
 */
class AppointmentsStateHolder(
    private val directory: PatientDirectory,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.patient.appointments"),
) {
    private val mutableState = MutableStateFlow<AppointmentsState>(AppointmentsState.Loading)

    /** The current screen state. */
    val state: StateFlow<AppointmentsState> = mutableState.asStateFlow()

    init {
        refresh()
    }

    /** Reloads the lists. */
    fun refresh() {
        scope.launch { load() }
    }

    /** Cancels one upcoming appointment. */
    fun cancel(appointmentId: String) {
        val shown = mutableState.value as? AppointmentsState.Loaded ?: return
        if (shown.cancelling != null) return
        val target = shown.upcoming.firstOrNull { it.id == appointmentId && it.canCancel } ?: return
        mutableState.value = shown.copy(cancelling = appointmentId, cancelError = null)
        scope.launch {
            val clinic =
                directory.load().let { (it as? Outcome.Success)?.value }?.clinics?.firstOrNull {
                    it.clinicId ==
                        target.clinicId
                }
            val api = clinic?.let(directory::clinicApi)
            val result = api?.cancel(appointmentId)
            when {
                result is Outcome.Success -> {
                    log.info("appointment.cancelled") { id("appointment", appointmentId) }
                    load()
                }

                result is Outcome.Failure && result.error.kind == ApiErrorKind.Conflict -> {
                    failCancel(CancelError.TooLate)
                }

                else -> {
                    failCancel(CancelError.Failed)
                }
            }
        }
    }

    private fun failCancel(error: CancelError) {
        val shown = mutableState.value as? AppointmentsState.Loaded ?: return
        mutableState.value = shown.copy(cancelling = null, cancelError = error)
    }

    private suspend fun load() {
        val api =
            when (val found = directory.app()) {
                is Outcome.Success -> found.value
                is Outcome.Failure -> return fail(ScreenError.of(found.error))
            }
        val names =
            (directory.load() as? Outcome.Success)
                ?.value
                ?.clinics
                ?.associate { it.clinicId to it.name }
                .orEmpty()
        when (val found = api.appointments()) {
            is Outcome.Success -> {
                mutableState.value =
                    AppointmentsState.Loaded(
                        upcoming = found.value.upcoming.map { it.view { id -> names[id].orEmpty() } },
                        past = found.value.past.map { it.view { id -> names[id].orEmpty() } },
                    )
            }

            is Outcome.Failure -> {
                fail(ScreenError.of(found.error))
            }
        }
    }

    private fun fail(error: ScreenError) {
        if (mutableState.value !is AppointmentsState.Loaded) mutableState.value = AppointmentsState.Failed(error)
    }
}
