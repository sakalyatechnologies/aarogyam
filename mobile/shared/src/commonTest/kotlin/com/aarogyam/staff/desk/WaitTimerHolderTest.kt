package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.walkin.tokenJson
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
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

    private val remind = "$SUNRISE/api/v1/queue/t1/remind"

    @Test
    fun remind_shows_on_no_reply_and_hides_for_a_minute_after_it_is_sent() =
        runTest {
            ServerCaps.reset()
            val backend = FakeBackend()
            backend.on(queue, { json(day(tokenJson())) })
            backend.on(remind, { json(tokenJson()) })
            now = issued + 30.seconds
            val holder = timer(backend)
            assertFalse(holder.entries().single().canRemind)
            now = issued + 61.seconds
            holder.tick()
            assertTrue(holder.entries().single().canRemind)
            holder.remind("t1")
            until { (holder.state.value as? WaitTimerState.Ready)?.entries?.single()?.canRemind == false }
            assertEquals(1, backend.count(remind))
            now = issued + 61.seconds + REMIND_AGAIN_AFTER_SECONDS.toInt().seconds
            holder.tick()
            assertTrue(holder.entries().single().canRemind)
        }

    @Test
    fun remind_too_soon_hides_the_button_and_not_waiting_reloads_the_queue() =
        runTest {
            val backend = FakeBackend()
            backend.on(queue, { json(day(tokenJson())) }, { json(day(called(tokenJson()))) })
            backend.on(
                remind,
                { apiError(HttpStatusCode.Conflict, "remind_too_soon") },
                { apiError(HttpStatusCode.Conflict, "not_waiting") },
            )
            now = issued + 90.seconds
            val holder = timer(backend)
            assertTrue(holder.entries().single().canRemind)
            holder.remind("t1")
            until { (holder.state.value as? WaitTimerState.Ready)?.entries?.single()?.canRemind == false }
            now = issued + 200.seconds
            holder.tick()
            holder.remind("t1")
            until { (holder.state.value as? WaitTimerState.Ready)?.entries?.isEmpty() == true }
            assertEquals(2, backend.count(queue))
        }

    private val Int.seconds get() = kotlin.time.Duration.parse("${this}s")
}
