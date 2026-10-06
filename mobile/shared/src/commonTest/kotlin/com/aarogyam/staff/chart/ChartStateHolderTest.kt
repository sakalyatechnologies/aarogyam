package com.aarogyam.staff.chart

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChartStateHolderTest {
    private val route = "$SUNRISE/api/v1/patients/p1/dental-chart"
    private val readWrite = listOf("patients.read", "clinical.read", "clinical.write")

    private fun entry(
        id: String,
        tooth: Int,
        finding: String,
        surface: String? = null,
        status: String = "current",
        note: String? = null,
    ) = """{"id":"$id","tooth":$tooth,"finding":"$finding","status":"$status","effective_at":"2026-09-20T04:30:00Z",
           "surface":${surface?.let { "\"$it\"" } ?: "null"},"note":${note?.let { "\"$it\"" } ?: "null"}}"""

    private fun chart(
        current: List<String>,
        history: List<String> = emptyList(),
    ) = """{"current":${current.joinToString(",", "[", "]")},"history":${history.joinToString(",", "[", "]")}}"""

    private val current =
        listOf(entry("e1", 46, "root_canal"), entry("e2", 36, "caries", "O"), entry("e3", 36, "filled", "M"))

    /** Answers GETs with [current] (and 46's history when asked) and POSTs with [onPost]. */
    private fun FakeBackend.serve(
        current: List<String> = this@ChartStateHolderTest.current,
        onPost: (HttpRequestData) -> Pair<HttpStatusCode, String> = { HttpStatusCode.OK to chart(current) },
    ) = on(route, { request ->
        if (request.method == HttpMethod.Post) {
            val (status, body) = onPost(request)
            if (status == HttpStatusCode.OK) json(body) else apiError(status, "conflict")
        } else {
            val history =
                if (request.url.parameters["tooth"] == "46") {
                    listOf(
                        entry("e1", 46, "root_canal", note = "Pulp exposed"),
                        entry("e0", 46, "caries", "O", status = "superseded"),
                    )
                } else {
                    emptyList()
                }
            json(chart(current, history))
        }
    })

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = readWrite,
        logs: MemoryLogSink = MemoryLogSink(),
    ): ChartStateHolder {
        val graph = testGraph(backend, backgroundScope, logs = logs)
        val clinic = openClinic(backend, graph, this, permissions)
        return graph.chart(clinic, "p1", backgroundScope)
    }

    private suspend fun ChartStateHolder.loaded(predicate: (ChartState.Loaded) -> Boolean = { true }) =
        state.first { it is ChartState.Loaded && predicate(it) } as ChartState.Loaded

    private fun ChartState.Loaded.tooth(number: Int) = (upper + lower).first { it.number == number }

    @Test
    fun the_whole_chart_is_one_request() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val state = holder(backend).loaded()
            assertEquals(1, backend.count(route))
            assertNull(
                backend.requests
                    .last()
                    .url.parameters["tooth"],
            )
            assertEquals(Dentition.Adult, state.dentition)
            assertEquals(32, state.total)
            assertEquals(2, state.needsCare)
            assertTrue(state.canRecord)
            assertEquals(Finding.RootCanal, state.tooth(46).whole)
            val molar = state.tooth(36)
            assertEquals(Finding.Caries, molar.finding(Surface.O))
            assertEquals(Finding.Caries, molar.headline)
            assertEquals(Finding.Filled, molar.finding(Surface.M))
            assertEquals(Finding.Sound, state.tooth(11).headline)
        }

    @Test
    fun a_child_chart_opens_on_the_primary_teeth_and_the_toggle_switches_sets() =
        runTest {
            val backend = FakeBackend()
            backend.serve(current = listOf(entry("c1", 85, "caries", "O")))
            val holder = holder(backend)
            val child = holder.loaded()
            assertEquals(Dentition.Child, child.dentition)
            assertEquals(20, child.total)
            assertEquals(1, child.needsCare)
            holder.select(85)
            holder.showDentition(Dentition.Adult)
            val adult = holder.loaded { it.dentition == Dentition.Adult }
            assertEquals(0, adult.needsCare)
            assertNull(adult.selected) // 85 is not an adult tooth
        }

    @Test
    fun picking_a_tooth_fetches_its_history_in_the_clinic_time_zone() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val holder = holder(backend)
            holder.loaded()
            holder.select(46)
            val selected = holder.loaded { it.selected?.history is HistoryState.Loaded }.selected
            assertEquals(46, selected?.tooth?.number)
            assertEquals(
                "46",
                backend.requests
                    .last()
                    .url.parameters["tooth"],
            )
            val history = assertIs<HistoryState.Loaded>(selected?.history).entries
            assertEquals(listOf(EntryStatus.Current, EntryStatus.Superseded), history.map { it.status })
            assertEquals(Surface.O, history[1].surface)
            assertEquals("Pulp exposed", history[0].note)
            assertEquals(LocalDate(2026, 9, 20), history[0].at?.date)
            assertEquals(LocalTime(10, 0), history[0].at?.time)
        }

    @Test
    fun a_recorded_finding_shows_at_once_and_then_as_the_server_saved_it() =
        runTest {
            val backend = FakeBackend()
            var posted: String? = null
            backend.serve(onPost = { request ->
                posted = (request.body as TextContent).text
                HttpStatusCode.OK to chart(current + entry("e4", 11, "fractured", "B"))
            })
            val holder = holder(backend)
            holder.loaded()
            holder.select(11, Surface.B)
            holder.record(Finding.Fractured, Surface.B, note = "  Chipped  ")
            val optimistic = holder.state.value as ChartState.Loaded
            assertTrue(optimistic.saving)
            assertTrue(optimistic.tooth(11).pending)
            assertEquals(Finding.Fractured, optimistic.tooth(11).finding(Surface.B))
            val saved = holder.loaded { !it.saving }
            assertFalse(saved.tooth(11).pending)
            assertEquals(Finding.Fractured, saved.tooth(11).finding(Surface.B))
            assertEquals(3, saved.needsCare)
            assertNull(saved.recordError)
            val body = posted.orEmpty()
            listOf(""""tooth":11""", """"finding":"fractured"""", """"surface":"B"""", """"note":"Chipped"""").forEach {
                assertTrue(it in body, body)
            }
        }

    @Test
    fun a_refused_finding_is_rolled_back() =
        runTest {
            val backend = FakeBackend()
            var posted: String? = null
            backend.serve(onPost = { request ->
                posted = (request.body as TextContent).text
                HttpStatusCode.Conflict to ""
            })
            val holder = holder(backend)
            holder.loaded()
            holder.select(36, Surface.O)
            // A crown covers the whole tooth: no surface is sent, and the surfaces are cleared on screen.
            holder.record(Finding.Crown, Surface.O)
            val optimistic = holder.state.value as ChartState.Loaded
            assertEquals(Finding.Crown, optimistic.tooth(36).whole)
            assertNull(optimistic.tooth(36).finding(Surface.O))
            val rolledBack = holder.loaded { !it.saving }
            assertEquals(ScreenError.Unknown, rolledBack.recordError)
            assertNull(rolledBack.tooth(36).whole)
            assertEquals(Finding.Caries, rolledBack.tooth(36).finding(Surface.O))
            assertFalse(rolledBack.tooth(36).pending)
            assertFalse("surface" in posted.orEmpty(), posted)
            holder.dismissRecordError()
            assertNull(holder.loaded().recordError)
        }

    @Test
    fun without_clinical_write_the_record_actions_are_hidden_and_inert() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val holder = holder(backend, permissions = listOf("patients.read", "clinical.read"))
            assertFalse(holder.loaded().canRecord)
            holder.select(11)
            holder.loaded { it.selected?.history is HistoryState.Loaded }
            holder.record(Finding.Caries, Surface.O)
            assertFalse((holder.state.value as ChartState.Loaded).saving)
            assertTrue(
                backend.requests.none {
                    it.method == HttpMethod.Post &&
                        it.url.encodedPath.endsWith("dental-chart")
                },
            )
        }

    @Test
    fun without_clinical_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val holder = holder(backend, permissions = listOf("patients.read"))
            assertEquals(ChartState.NotAllowed, holder.state.value)
            holder.refresh()
            assertEquals(0, backend.count(route))
        }

    @Test
    fun a_failed_load_fails_the_tab_and_logs_ids_only() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.NotImplemented, "internal") })
            val logs = MemoryLogSink()
            val state = holder(backend, logs = logs).state.first { it is ChartState.Failed }
            assertEquals(ChartState.Failed(ScreenError.Server), state)
            val text = logs.records.joinToString("\n") { it.format() }
            assertTrue("chart.load_failed" in text)
            assertTrue("p1" in text)
        }
}
