package com.aarogyam.staff.queue

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.walkin.tokenJson
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs

class QueueStateHolderTest {
    private val queue = "$SUNRISE/api/v1/queue"
    private val day = """{"date":"2026-10-08","items":[${tokenJson(
        "t1",
        1,
    )},${tokenJson("t2", 2, "done", "p2", "Kavya")}]}"""

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("appointments.read", "appointments.write", "clinical.write"),
    ): QueueStateHolder {
        backend.on(queue, { json(day) })
        val graph = testGraph(backend, backgroundScope)
        return graph.queue(openClinic(backend, graph, this, permissions), backgroundScope)
    }

    private fun QueueStateHolder.loaded() = assertIs<QueueState.Loaded>(state.value)

    private suspend fun QueueStateHolder.awaitLoaded(until: (QueueState.Loaded) -> Boolean = { true }) =
        state.first { it is QueueState.Loaded && until(it) } as QueueState.Loaded

    @Test
    fun opening_loads_the_queue_once_split_into_waiting_and_finished() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, permissions = listOf("appointments.read"))
            val state = holder.awaitLoaded()
            assertEquals(listOf(1), state.waiting.map { it.tokenNumber })
            assertEquals(TokenStatus.Done, state.finished.single().status)
            assertFalse(state.canMove || state.canStartVisit)
            holder.seat("t1") // without appointments.write nothing is sent
            assertEquals(0, backend.count("$queue/t1/status"))
        }

    @Test
    fun without_appointments_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, permissions = listOf("patients.read"))
            assertEquals(QueueState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count(queue))
        }

    @Test
    fun seat_sends_one_status_change_and_updates_the_row() =
        runTest {
            val backend = FakeBackend()
            backend.on("$queue/t1/status", { json(tokenJson("t1", 1, "in_chair")) })
            val holder = holder(backend)
            holder.awaitLoaded()
            holder.seat("t1")
            holder.seat("t1") // double tap
            holder.awaitLoaded { it.rows[0].status == TokenStatus.InChair }
            assertEquals(1, backend.count("$queue/t1/status"))
            assertEquals(
                """{"status":"in_chair"}""",
                backend.requests
                    .last()
                    .body
                    .toByteArray()
                    .decodeToString(),
            )
            assertEquals(TokenStatus.InChair, holder.loaded().rows[0].status)
        }

    @Test
    fun start_visit_emits_the_visit_to_open() =
        runTest {
            val backend = FakeBackend()
            val started =
                """{"created":true,"token":${tokenJson("t1", 1, "in_chair")},"visit":{"id":"v1","number":"V-1",
                   "patient_id":"p1","clinician":{"id":"m1","name":"Dr. Patil"},"status":"open","started_at":"2026-10-08T04:30:00Z"}}"""
            backend.on("$queue/t1/start-visit", { json(started, HttpStatusCode.Created) })
            val holder = holder(backend)
            holder.awaitLoaded()
            val opened = backgroundScope.async { holder.opened.first() }
            holder.startVisit("t1")
            assertEquals(VisitOpened("p1", "v1"), opened.await())
            assertEquals(TokenStatus.InChair, holder.loaded().rows[0].status)
        }

    @Test
    fun a_refused_move_reloads_the_queue_and_shows_the_error() =
        runTest {
            val backend = FakeBackend()
            backend.on("$queue/t1/status", { apiError(HttpStatusCode.Forbidden, "forbidden") })
            val holder = holder(backend)
            holder.awaitLoaded()
            holder.left("t1")
            holder.awaitLoaded { it.actionError != null && !it.rows[0].busy }
            assertEquals(2, backend.count(queue))
            assertEquals(ScreenError.NotAllowed, holder.loaded().actionError)
            assertFalse(holder.loaded().rows[0].busy)
        }
}
