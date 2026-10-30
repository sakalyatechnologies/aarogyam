package com.aarogyam.staff

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Whether the app is open and in front. Polls run only while it is (founder decision, 29 Oct 2026: no
 * background polling, and the event stream stays off until launch). The apps set it from their lifecycle:
 * iOS from the scene phase, Android from the activity's start and stop.
 */
object AppForeground {
    private val mutable = MutableStateFlow(true)
    val inFront: StateFlow<Boolean> = mutable.asStateFlow()

    fun set(inFront: Boolean) {
        mutable.value = inFront
    }
}

/**
 * Runs [block] now and then every [periodMillis] while [inFront] is true. In the background it waits, and it
 * runs [block] at once when the app comes back, so the screen is fresh on return. Never returns; cancel its job.
 */
suspend fun pollWhileInFront(
    periodMillis: Long,
    inFront: StateFlow<Boolean> = AppForeground.inFront,
    block: suspend () -> Unit,
) {
    while (true) {
        inFront.first { it }
        block()
        // The period, cut short if the app leaves the front.
        withTimeoutOrNull(periodMillis) { inFront.first { !it } }
    }
}
