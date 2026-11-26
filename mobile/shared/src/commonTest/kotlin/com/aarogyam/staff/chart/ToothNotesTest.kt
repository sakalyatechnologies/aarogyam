package com.aarogyam.staff.chart

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ToothNotesTest {
    private val route = "$SUNRISE/api/v1/patients/p1/dental-chart"
    private val rights = listOf("patients.read", "clinical.read", "clinical.write")

    private fun isNotePost(request: HttpRequestData) =
        request.method == HttpMethod.Post && request.url.encodedPath.endsWith("/notes")

    private fun note(
        id: String,
        body: String,
    ) = """{"id":"$id","tooth":16,"body":"$body","recorded_by_name":"Dr Rao","recorded_at":"2026-11-18T04:30:00Z"}"""

    @Test
    fun the_note_saves_once_when_the_sheet_closes_and_joins_the_history() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json("""{"current":[],"history":[],"terms":[]}""") })
            backend.on("$route/teeth/16/notes", { request ->
                if (request.method == HttpMethod.Post) {
                    json(note("n2", "Sensitive to cold"))
                } else {
                    json("""{"items":[${note("n1", "Old note")}]}""")
                }
            })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, rights)
            val chart = graph.chart(clinic, "p1", backgroundScope)
            chart.state.first { it is ChartState.Loaded }
            val sheet = ToothSheetStateHolder(clinic, chart, null, backgroundScope)
            sheet.openTooth(16)
            val past = sheet.toothNotes.first { it.items.isNotEmpty() }
            assertEquals(listOf("Old note"), past.items.map { it.body })
            assertEquals("Dr Rao", past.items.single().by)
            sheet.editHealthNote("Sensitive to cold")
            sheet.saveNote(16)
            sheet.saveNote(16)
            sheet.toothNotes.first { it.items.size == 2 }
            val posts = backend.requests.filter { isNotePost(it) }
            assertEquals(1, posts.size, "saved once; the box is empty after")
            assertTrue("Sensitive to cold" in (posts.single().body as TextContent).text)
            assertEquals(
                listOf("Sensitive to cold", "Old note"),
                sheet.toothNotes.value.items
                    .map { it.body },
            )
            assertTrue(backend.requests.none { it.url.encodedPath.endsWith("/status") }, "no status call for a note")
        }

    @Test
    fun an_empty_note_is_not_saved_and_add_treatment_takes_the_note_with_it() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json("""{"current":[],"history":[],"terms":[]}""") })
            backend.on("$route/teeth/16/notes", { json("""{"items":[]}""") })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, rights)
            val chart = graph.chart(clinic, "p1", backgroundScope)
            chart.state.first { it is ChartState.Loaded }
            val sheet = ToothSheetStateHolder(clinic, chart, null, backgroundScope)
            sheet.openTooth(16)
            sheet.editHealthNote("   ")
            sheet.saveNote(16)
            runCurrent()
            val written = backend.requests.filter { isNotePost(it) }
            assertTrue(written.isEmpty(), "blank is skipped")
            sheet.editHealthNote("Check later")
            sheet.beginTreatment()
            assertEquals("Check later", sheet.form.value.note)
            assertEquals("", sheet.health.value.note)
            sheet.endTreatment()
            assertEquals("Check later", sheet.health.value.note)
        }
}
