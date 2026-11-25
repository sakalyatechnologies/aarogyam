package com.aarogyam.staff.queue

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.walkin.walkInJson
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ArrivalsHolderTest {
    private val arrivals = "$SUNRISE/api/v1/arrivals"
    private val list =
        """{"items":[{"id":"a1","created_at":"2026-10-08T04:00:00Z","first_name":"Meera","last_name":"Shah",
        "phone":"+919876543210","for_self":true,"reasons":["checkup"],"reason_labels":["Check-up"],"health":[],"health_labels":[],
        "reminders":true,"matches":{"family_group":[],"items":[{"id":"p9","number":"SD-1","full_name":"Meera Shah","sex":"female"}]}}]}"""

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> =
            listOf("appointments.read", "patients.read", "patients.write", "appointments.write", "intake.write"),
    ): QueueStateHolder {
        backend.on(arrivals, { json(list) })
        backend.on("$SUNRISE/api/v1/queue", { json("""{"date":"2026-10-08","items":[]}""") })
        val graph = testGraph(backend, backgroundScope)
        return graph.queue(openClinic(backend, graph, this, permissions), backgroundScope)
    }

    private suspend fun QueueStateHolder.shown() =
        arrivals.state.first {
            it is ArrivalsState.Shown && it.count > 0
        } as ArrivalsState.Shown

    @Test
    fun the_queue_load_reads_arrivals_and_defaults_to_a_new_patient() =
        runTest {
            val backend = FakeBackend()
            val row = holder(backend).shown().rows.single()
            assertEquals("Meera Shah", row.name)
            assertNull(row.chosenPatientId)
            assertEquals("p9", row.matches.single().id)
        }

    @Test
    fun accept_sends_the_chosen_patient_and_removes_the_row() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$arrivals/a1/accept",
                { json(walkInJson(false), HttpStatusCode.Created) },
            )
            val queue = holder(backend)
            queue.shown()
            backend.on(arrivals, { json("""{"items":[]}""") }) // the reload after it was handled
            queue.arrivals.choose("a1", "p9")
            queue.arrivals.accept("a1")
            queue.arrivals.state.first { it is ArrivalsState.Shown && it.count == 0 }
            assertEquals(1, backend.count("$arrivals/a1/accept"))
        }

    @Test
    fun already_handled_removes_the_row_with_a_notice() =
        runTest {
            val backend = FakeBackend()
            backend.on("$arrivals/a1/dismiss", { apiError(HttpStatusCode.Conflict, "already_handled") })
            val queue = holder(backend)
            queue.shown()
            backend.on(arrivals, { json("""{"items":[]}""") }) // the reload after it was handled
            queue.arrivals.dismiss("a1")
            val after =
                queue.arrivals.state.first {
                    it is ArrivalsState.Shown && it.notice != null
                } as ArrivalsState.Shown
            assertEquals(ArrivalNotice.AlreadyHandled, after.notice)
            assertEquals(0, after.count)
        }

    @Test
    fun without_patients_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val queue = holder(backend, permissions = listOf("appointments.read"))
            assertEquals(ArrivalsState.Hidden, queue.arrivals.state.value)
            assertEquals(0, backend.count(arrivals))
        }
}
