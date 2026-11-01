package com.aarogyam.staff.desk

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.missedAppointments
import com.aarogyam.staff.api.model.MissedAppointment
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the Missed card draws. */
sealed interface MissedState {
    data object Loading : MissedState

    /** The role lacks `appointments.read`; nothing was requested. */
    data object NotAllowed : MissedState

    data class Failed(
        val error: ScreenError,
    ) : MissedState

    /** [date] is the clinic day the server answered for (`YYYY-MM-DD`); [items] are its no-shows. */
    data class Loaded(
        val date: String,
        val items: List<MissedAppointment>,
    ) : MissedState
}

/** Today's no-shows with their follow-ups (`GET /appointments/missed`). */
class MissedHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.missed"),
) {
    private val allowed = APPOINTMENTS_READ in clinic.permissions
    private val mutableState =
        MutableStateFlow<MissedState>(if (allowed) MissedState.Loading else MissedState.NotAllowed)
    val state: StateFlow<MissedState> = mutableState.asStateFlow()

    init {
        if (allowed) load()
    }

    /** Reloads the list; the last good list stays on screen until the new one arrives. */
    fun refresh() {
        if (!allowed) return
        if (mutableState.value is MissedState.Failed) mutableState.value = MissedState.Loading
        load()
    }

    private fun load() {
        scope.launch {
            when (val result = clinic.api.missedAppointments()) {
                is Outcome.Success -> {
                    mutableState.value = MissedState.Loaded(result.value.date, result.value.items)
                }

                is Outcome.Failure -> {
                    log.warn("missed.load_failed") { code("error", result.error.code.value) }
                    // A failed refresh keeps the last good list.
                    if (mutableState.value !is MissedState.Loaded) {
                        mutableState.value = MissedState.Failed(ScreenError.of(result.error))
                    }
                }
            }
        }
    }

    private companion object {
        const val APPOINTMENTS_READ = "appointments.read"
    }
}
