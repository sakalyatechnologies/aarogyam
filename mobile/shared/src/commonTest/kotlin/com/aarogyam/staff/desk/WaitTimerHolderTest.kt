package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.walkin.tokenJson
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.time.Instant

/** A7/R11: the wait timer on an injected clock. The fixture token was issued at 04:00:00Z. */
@OptIn(ExperimentalCoroutinesApi::class)
class WaitTimerHolderTest {
    private val queue = "$SUNRISE/api/v1/queue"
    private val issued = Instant.parse("2026-10-08T04:00:00Z")
    private var now = issued

    private fun day(token: String) = """{"date":"2026-10-08","items":[$token]}"""

    private fun called(token: String) =
        token.replace("\"issued_at\"", "\"called_at\":\"2026-10-08T04:00:40Z\",\"issued_at\"")

    private suspend fun TestScope.timer(backend: FakeBackend): WaitTimerStateHolder {
        val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("appointments.read"))
        return WaitTimerStateHolder(clinic, backgroundScope, { now }, tickMillis = 0)
    }

    private suspend fun WaitTimerStateHolder.entries(): List<WaitEntry> =
        assertIs<WaitTimerState.Ready>(state.first { it is WaitTimerState.Ready }).entries

    @Test
    fun fifty_nine_seconds_is_fresh_and_sixty_is_no_reply() =
        runTest {
            val backend = FakeBackend()
            backend.on(queue, { json(day(tokenJson())) })
            now = issued + 59.seconds
            val holder = timer(backend)
            val fresh = holder.entries().single()
            assertEquals(WaitState.Fresh, fresh.state)
            assertEquals("0:59", fresh.clock)
            assertEquals(null, fresh.checkWithKey)
            now = issued + 60.seconds
            holder.tick()
            val late = holder.entries().single()
            assertEquals(WaitState.NoReply, late.state)
            assertEquals("1:00", late.clock)
            assertEquals(CHECK_WITH_DOCTOR_KEY, late.checkWithKey)
            assertEquals("Dr. Patil", late.doctor)
        }

    @Test
    fun a_called_token_leaves_no_reply() =
        runTest {
            val backend = FakeBackend()
            backend.on(queue, { json(day(tokenJson())) }, { json(day(called(tokenJson()))) })
            now = issued + 90.seconds
            val holder = timer(backend)
            assertEquals(WaitState.NoReply, holder.entries().single().state)
            holder.refresh()
            until { (holder.state.value as? WaitTimerState.Ready)?.entries?.isEmpty() == true }
            assertEquals(emptyList(), holder.entries())
        }

    @Test
    fun remind_is_off_until_the_server_has_it_and_sends_nothing() =
        runTest {
            ServerCaps.reset()
            val backend = FakeBackend()
            backend.on(queue, { json(day(tokenJson())) })
            val holder = timer(backend)
            holder.entries()
            val before = backend.requests.size
            assertFalse(holder.canRemind)
            holder.remind("t1")
            runCurrent()
            assertEquals(before, backend.requests.size)
        }

    private val Int.seconds get() = kotlin.time.Duration.parse("${this}s")
}
