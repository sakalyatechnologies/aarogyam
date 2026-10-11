package com.aarogyam.staff

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Tells a screen that something on the server changed, so it reloads. Today it is a timer
 * ([PollingUpdates]); the server's event stream (BE3, SSE) replaces it without the screens changing.
 */
interface LiveUpdates {
    /** Emits each time the screen should reload; collect it only while the screen is visible. */
    fun changes(): Flow<Unit>
}

/** A reload every [intervalMillis] (20 seconds), the stand-in until SSE. */
class PollingUpdates(
    private val intervalMillis: Long = POLL_MILLIS,
) : LiveUpdates {
    override fun changes(): Flow<Unit> =
        flow {
            while (true) {
                delay(intervalMillis)
                emit(Unit)
            }
        }

    companion object {
        const val POLL_MILLIS = 20_000L
    }
}
