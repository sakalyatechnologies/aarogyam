package com.aarogyam.staff

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow

/**
 * Tells a screen that something on the server changed, so it reloads. [PollingUpdates] is the timer;
 * `SseLiveUpdates` (live/) adds the server's event stream on top of it, without the screens changing.
 */
interface LiveUpdates {
    /** Emits each time the screen should reload; collect it only while the screen is visible. */
    fun changes(): Flow<Unit>
}

/**
 * A reload every [intervalMillis] (20 seconds), or every [connectedMillis] (120 seconds) while
 * [connected] says the event stream is open and doing the real work. This is the one place the poll
 * slows down; screens never choose.
 */
class PollingUpdates(
    private val intervalMillis: Long = POLL_MILLIS,
    private val connected: StateFlow<Boolean> = MutableStateFlow(false),
    private val connectedMillis: Long = CONNECTED_POLL_MILLIS,
) : LiveUpdates {
    /** For Swift, which does not see default arguments: a plain timer. */
    constructor(intervalMillis: Long) : this(intervalMillis, MutableStateFlow(false), CONNECTED_POLL_MILLIS)

    @OptIn(ExperimentalCoroutinesApi::class)
    override fun changes(): Flow<Unit> =
        connected.flatMapLatest { open ->
            val wait = if (open) connectedMillis else intervalMillis
            flow {
                while (true) {
                    delay(wait)
                    emit(Unit)
                }
            }
        }

    companion object {
        const val POLL_MILLIS = 20_000L
        const val CONNECTED_POLL_MILLIS = 120_000L
    }
}
