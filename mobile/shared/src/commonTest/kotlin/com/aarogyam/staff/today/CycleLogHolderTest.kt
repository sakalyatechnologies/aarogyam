package com.aarogyam.staff.today

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.todayBody
import com.sakalya.mobile.core.Logger
import io.ktor.http.HttpMethod
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CycleLogHolderTest {
    private val cycles = "$SUNRISE/api/v1/sterilisation-cycles"
    private val first =
        """{"id":"c1","run_at":"2026-10-05T04:00:00Z","load_note":"Handpieces","recorded_by_name":"Dr Rao"}"""

    @Test
    fun logging_a_cycle_sends_the_trimmed_note_adds_it_to_the_list_and_tells_today_to_reload() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { json(todayBody()) })
            backend.on(cycles, { request ->
                if (request.method == HttpMethod.Post) {
                    json("""{"id":"c2","run_at":"2026-10-05T05:00:00Z","load_note":"Burs"}""")
                } else {
                    json("""{"date":"2026-10-05","items":[$first]}""")
                }
            })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.read", "tasks.use"))
            var logged = 0
            val cycles = CycleLogHolder(clinic, backgroundScope, Logger("aarogyam.test")) { logged++ }
            cycles.load()
            cycles.state.first { it.cycles.isNotEmpty() }
            cycles.record("  Burs  ")
            cycles.state.first { it.cycles.size == 2 }
            assertEquals(
                "c2",
                cycles.state.value.cycles
                    .first()
                    .id,
            )
            assertFalse(cycles.state.value.saving)
            val post = backend.requests.last { it.method == HttpMethod.Post }
            assertTrue(""""load_note":"Burs"""" in (post.body as TextContent).text)
            assertEquals(1, logged, "Today is told to reload")
        }

    @Test
    fun without_tasks_use_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { json(todayBody()) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.read"))
            val holder = graph.today(clinic, backgroundScope)
            assertFalse(holder.cycles.allowed)
            holder.cycles.load()
            holder.cycles.record("x")
            assertTrue(backend.requests.none { it.url.encodedPath.endsWith("/sterilisation-cycles") })
            assertNull(holder.cycles.state.value.error)
        }
}
