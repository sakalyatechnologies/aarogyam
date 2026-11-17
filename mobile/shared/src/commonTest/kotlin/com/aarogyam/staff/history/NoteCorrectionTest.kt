package com.aarogyam.staff.history

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private fun noteJson(
    id: String,
    status: String,
    author: String = "m1",
    s: String? = null,
    p: String? = null,
    supersedes: String? = null,
) = """{"id":"$id","visit_id":"v1","kind":"soap","source":"typed","status":"$status",
    "author":{"id":"$author","name":"Dr. $author"},"created_at":"2026-10-01T04:30:00Z",
    "updated_at":"2026-10-01T04:30:00Z","row_version":1,"addenda":[],"supersedes_id":${supersedes?.let { "\"$it\"" }},
    "sections":{"subjective":${s?.let { "\"$it\"" }},"plan":${p?.let { "\"$it\"" }}}}"""

class NoteCorrectionTest {
    private val visit = "$SUNRISE/api/v1/visits/v1"
    private val write = listOf("patients.read", "clinical.read", "clinical.write")

    private fun FakeBackend.serve(
        status: String = "closed",
        notes: String,
    ) {
        on("$SUNRISE/api/v1/patients/p1/prescriptions", { json("""{"items":[]}""") })
        visit(status, notes)
    }

    private fun FakeBackend.visit(
        status: String,
        notes: String,
    ) = on(
        visit,
        {
            json(
                """{"visit":{"id":"v1","number":"V-1","patient_id":"p1","clinician":{"id":"m1","name":"Dr. m1"},
                "status":"$status","started_at":"2026-10-01T04:30:00Z"},
                "notes":[$notes],"procedures":[],"chart_entries":[],"observations":[],"attachments":[]}""",
            )
        },
    )

    private suspend fun TestScope.view(
        backend: FakeBackend,
        permissions: List<String> = write,
    ): VisitDetailView {
        val graph = testGraph(backend, backgroundScope)
        val holder = graph.visitDetail(openClinic(backend, graph, this, permissions), "v1", "p1", backgroundScope)
        return (holder.state.first { it is VisitDetailState.Loaded } as VisitDetailState.Loaded).view
    }

    private fun HttpRequestData.text() = (body as TextContent).text

    @Test
    fun signed_notes_and_my_drafts_in_a_closed_visit_can_be_corrected() =
        runTest {
            val backend = FakeBackend()
            backend.serve(
                notes =
                    listOf(
                        noteJson("n1", "signed", s = "Pain", supersedes = "n0"),
                        noteJson("n2", "draft", s = "Mine"),
                        noteJson("n3", "draft", author = "m9", s = "Someone else's"),
                        noteJson("n4", "entered_in_error", s = "Wrong chart"),
                    ).joinToString(","),
            )
            val notes = view(backend).correctable
            assertEquals(listOf("n1", "n2"), notes.map { it.id })
            assertEquals("Pain", notes.first().subjective)
            assertEquals(listOf(true, false), notes.map { it.corrected })
        }

    @Test
    fun nothing_is_correctable_without_clinical_write_and_drafts_wait_for_the_close() =
        runTest {
            val notes =
                listOf(
                    noteJson("n1", "signed", s = "Pain"),
                    noteJson("n2", "draft", s = "Mine"),
                ).joinToString(",")
            val reader = FakeBackend().apply { serve(notes = notes) }
            assertTrue(view(reader, listOf("patients.read", "clinical.read")).correctable.isEmpty())
            val open = FakeBackend().apply { serve(status = "open", notes = notes) }
            assertEquals(listOf("n1"), view(open).correctable.map { it.id })
        }

    @Test
    fun a_correction_sends_the_whole_text_once_and_a_retry_keeps_its_id() =
        runTest {
            val backend = FakeBackend()
            var calls = 0
            backend.on(
                "$SUNRISE/api/v1/notes/n1/amend",
                {
                    calls++
                    if (calls == 1) {
                        json("""{"error":{"code":"invalid","message":"x"}}""", HttpStatusCode.BadRequest)
                    } else {
                        json(noteJson("n5", "signed", s = "Pain on biting", supersedes = "n1"), HttpStatusCode.Created)
                    }
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, write)
            val note = CorrectableNote("n1", "Dr. m1", "Pain", "", "", "Review", corrected = false)
            val holder = graph.noteCorrection(clinic, note, backgroundScope)
            assertFalse(holder.state.value.canSave, "nothing changed yet")
            holder.set(NoteSection.Subjective, "Pain on biting")
            holder.set(NoteSection.Plan, "  ")
            assertTrue(holder.state.value.canSave)
            holder.save()
            holder.state.first { !it.saving && it.error != null }
            holder.save()
            assertTrue(holder.state.first { it.saved }.saved)
            val sent = backend.requests.filter { it.url.encodedPath == "/api/v1/notes/n1/amend" }
            assertEquals(2, sent.size)
            assertTrue(sent.all { it.method == HttpMethod.Post })
            val ids = sent.map { Regex(""""id":"([^"]+)"""").find(it.text())?.groupValues?.get(1) }
            assertEquals(1, ids.toSet().size, "a retry keeps the client id")
            val body = sent.last().text()
            assertTrue(""""subjective":"Pain on biting"""" in body && """"plan"""" !in body, body)
        }

    @Test
    fun a_note_corrected_meanwhile_asks_for_a_reload() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/notes/n1/amend",
                { json("""{"error":{"code":"conflict","message":"already corrected"}}""", HttpStatusCode.Conflict) },
            )
            val graph = testGraph(backend, backgroundScope)
            val note = CorrectableNote("n1", "Dr. m1", "Pain", "", "", "", corrected = false)
            val holder = graph.noteCorrection(openClinic(backend, graph, this, write), note, backgroundScope)
            holder.set(NoteSection.Assessment, "Pulpitis")
            holder.save()
            val s = holder.state.first { it.stale }
            assertFalse(s.canSave)
            assertFalse(s.saved)
        }

    @Test
    fun earlier_versions_load_newest_first() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/notes/n5/versions",
                { json("""{"items":[${noteJson("n1", "signed", s = "Pain", p = " ")}]}""") },
            )
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.noteVersions(openClinic(backend, graph, this, write), "n5", backgroundScope)
            val loaded = holder.state.first { it is NoteVersionsState.Loaded } as NoteVersionsState.Loaded
            val v = loaded.versions.single()
            assertEquals("Pain", v.subjective)
            assertEquals(null, v.plan)
            assertEquals("Dr. m1", v.author)
        }
}
