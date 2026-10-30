package com.aarogyam.staff.live

import com.aarogyam.staff.PollingUpdates
import com.aarogyam.staff.pollWhileInFront
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** Founder decision, 29 Oct 2026: screens poll only while the app is open and in front. */
class ForegroundPollTest {
    @Test
    fun the_poll_stops_in_the_background_and_runs_at_once_on_return() =
        runTest {
            val front = MutableStateFlow(true)
            var runs = 0
            backgroundScope.launch { pollWhileInFront(20_000, front) { runs++ } }
            runCurrent()
            assertEquals(1, runs)
            advanceTimeBy(20_001)
            assertEquals(2, runs)

            front.value = false
            advanceTimeBy(120_000)
            assertEquals(2, runs)

            front.value = true
            runCurrent()
            assertEquals(3, runs)
            advanceTimeBy(20_001)
            assertEquals(4, runs)
        }

    @Test
    fun the_screen_timer_is_silent_in_the_background_and_reloads_on_return() =
        runTest {
            val front = MutableStateFlow(true)
            var reloads = 0
            backgroundScope.launch {
                PollingUpdates(intervalMillis = 20_000, inFront = front).changes().collect { reloads++ }
            }
            advanceTimeBy(20_001)
            assertEquals(1, reloads)

            front.value = false
            advanceTimeBy(300_000)
            assertEquals(1, reloads)

            front.value = true
            runCurrent()
            assertEquals(2, reloads)
            advanceTimeBy(20_001)
            assertEquals(3, reloads)
        }
}
