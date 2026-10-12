package com.aarogyam.staff.desk

import com.aarogyam.staff.LiveUpdates
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.queue
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the availability strip draws. */
sealed interface AvailabilityState {
    data object Loading : AvailabilityState

    /** The role lacks `appointments.read`; nothing was requested. */
    data object NotAllowed : AvailabilityState

    /** Nothing loaded yet; once [Loaded], a failed refresh keeps the last strip. */
    data class Failed(
        val error: ScreenError,
    ) : AvailabilityState

    data class Loaded(
        val strip: AvailabilityStrip,
    ) : AvailabilityState
}

/**
 * Doctor and chair availability for the desk (v10 R6): one `GET /today` and one `GET /queue`,
 * folded by [availabilityOf]. No API of its own. Call [refresh] on the board's poll or
 * [observe] live updates.
 */
interface AvailabilityHolder {
    val state: StateFlow<AvailabilityState>

    fun refresh()

    fun observe(live: LiveUpdates)
}

private class AvailabilityStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
) : AvailabilityHolder {
    private val allowed = "appointments.read" in clinic.permissions
    private val mutableState =
        MutableStateFlow<AvailabilityState>(if (allowed) AvailabilityState.Loading else AvailabilityState.NotAllowed)
    override val state: StateFlow<AvailabilityState> = mutableState.asStateFlow()
    private var loading = false

    init {
        if (allowed) refresh()
    }

    override fun refresh() {
        if (!allowed || loading) return
        loading = true
        scope.launch {
            try {
                load()
            } finally {
                loading = false
            }
        }
    }

    override fun observe(live: LiveUpdates) {
        scope.launch { live.changes().collect { refresh() } }
    }

    private suspend fun load() {
        val today = clinic.api.today()
        val queue = clinic.api.queue()
        if (today is Outcome.Success && queue is Outcome.Success) {
            val now = minuteOfDay(today.value.asOf, clinic.timeZone) ?: 0
            mutableState.value = AvailabilityState.Loaded(availabilityOf(today.value, queue.value.items, now))
            return
        }
        val error = (today as? Outcome.Failure)?.error ?: (queue as Outcome.Failure).error
        if (mutableState.value !is AvailabilityState.Loaded) {
            mutableState.value = AvailabilityState.Failed(ScreenError.of(error))
        }
    }
}

internal fun createAvailability(
    clinic: ClinicContext,
    scope: CoroutineScope,
): AvailabilityHolder = AvailabilityStateHolder(clinic, scope)
