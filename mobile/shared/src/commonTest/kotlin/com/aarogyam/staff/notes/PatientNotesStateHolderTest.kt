package com.aarogyam.staff.notes

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.richtext.RichText
import com.aarogyam.staff.richtext.RichTextProblem
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val SUMMARY =
    """{"body":"## History\n- **Diabetic**","row_version":2,"updated_at":"2026-10-02T20:00:00Z","updated_by":"Dr. Patil"}"""
private const val NOTE =
    """{"id":"n1","visit_id":"v1","visit_number":"V-7","kind":"soap","status":"signed",
       "sections":{"subjective":"Pain **on chewing**","plan":"- RCT"},"author":{"id":"m1","name":"Dr. Patil"},
       "signed_at":"2026-10-02T20:00:00Z","created_at":"2026-10-02T19:00:00Z","updated_at":"2026-10-02T20:00:00Z",
       "row_version":3,"addenda_count":1}"""

private fun notes(summary: String? = SUMMARY) = """{"summary":${summary ?: "null"},"visit_notes":[$NOTE]}"""

class PatientNotesStateHolderTest {
    private val route = "$SUNRISE/api/v1/patients/p1/notes"
    private val save = "$SUNRISE/api/v1/patients/p1/summary-note"

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("patients.read", "clinical.read", "clinical.write"),
    ): PatientNotesStateHolder {
        val graph = testGraph(backend, backgroundScope)
        return graph.patientNotes(openClinic(backend, graph, this, permissions), "p1", backgroundScope)
    }

    private suspend fun PatientNotesStateHolder.loaded() =
        state.first {
            it is PatientNotesState.Loaded
        } as PatientNotesState.Loaded

    @Test
    fun shows_the_summary_and_the_visit_notes_in_one_request() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(notes()) })
            val loaded = holder(backend).loaded()
            assertEquals("## History\n- **Diabetic**", loaded.summary?.body)
            assertEquals(2L, loaded.summary?.version)
            assertEquals(
                "2026-10-03",
                loaded.summary
                    ?.updatedAt
                    ?.date
                    .toString(),
                "Asia/Kolkata is ahead of UTC",
            )
            val note = loaded.visitNotes.single()
            assertEquals("V-7", note.visitNumber)
            assertEquals(NoteStatus.Signed, note.status)
            assertEquals(listOf(NoteSection.Subjective, NoteSection.Plan), note.sections.map { it.section })
            assertEquals(1, note.addendaCount)
            assertTrue(loaded.canEdit)
            assertEquals(1, backend.count(route))
        }

    @Test
    fun a_role_without_clinical_read_requests_nothing() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, listOf("patients.read"))
            assertEquals(PatientNotesState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count(route))
        }

    @Test
    fun a_reader_cannot_open_the_editor() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(notes()) })
            val holder = holder(backend, listOf("patients.read", "clinical.read"))
            assertEquals(false, holder.loaded().canEdit)
            holder.startEditing()
            assertNull(holder.loaded().editor)
        }

    @Test
    fun saves_the_edit_with_the_version_it_started_from() =
        runTest {
            val backend = FakeBackend()
            var sentVersion: String? = null
            var sentBody = ""
            backend.on(route, { json(notes()) })
            backend.on(save, { request ->
                sentVersion = request.headers["If-Match"]
                sentBody = (request.body as io.ktor.http.content.TextContent).text
                json(SUMMARY.replace("\"row_version\":2", "\"row_version\":3"))
            })
            val holder = holder(backend)
            holder.loaded()
            holder.startEditing()
            holder.edit("Updated **text**")
            holder.save()
            val done =
                holder.state.first {
                    it is PatientNotesState.Loaded && it.editor == null
                } as PatientNotesState.Loaded
            assertEquals("\"2\"", sentVersion)
            assertTrue(sentBody.contains("Updated **text**"), sentBody)
            assertEquals(3L, done.summary?.version)
            assertEquals(HttpMethod.Put, backend.requests.last().method)
        }

    @Test
    fun the_first_save_sends_no_version() =
        runTest {
            val backend = FakeBackend()
            var sentVersion: String? = "unset"
            backend.on(route, { json(notes(null)) })
            backend.on(save, { request ->
                sentVersion = request.headers["If-Match"]
                json(SUMMARY.replace("\"row_version\":2", "\"row_version\":1"))
            })
            val holder = holder(backend)
            assertNull(holder.loaded().summary)
            holder.startEditing()
            holder.edit("First")
            holder.save()
            holder.state.first { it is PatientNotesState.Loaded && it.editor == null && it.summary != null }
            assertNull(sentVersion)
        }

    @Test
    fun text_outside_the_subset_is_refused_before_it_is_sent() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(notes()) })
            val holder = holder(backend)
            holder.loaded()
            holder.startEditing()
            holder.edit("hello <b>there</b>")
            assertEquals(false, holder.loaded().editor?.canSave)
            holder.save()
            val editor = holder.loaded().editor
            assertEquals(SaveProblem.Format(RichTextProblem.Html), editor?.problem)
            assertEquals(0, backend.count(save))
        }

    @Test
    fun a_note_changed_meanwhile_is_reported_and_reloaded_on_cancel() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                route,
                { json(notes()) },
                { json(notes(SUMMARY.replace("\"row_version\":2", "\"row_version\":5"))) },
            )
            backend.on(save, { apiError(HttpStatusCode.PreconditionFailed, "stale_version") })
            val holder = holder(backend)
            holder.loaded()
            holder.startEditing()
            holder.edit("Mine")
            holder.save()
            val refused =
                holder.state.first {
                    it is PatientNotesState.Loaded && it.editor?.problem != null
                } as PatientNotesState.Loaded
            assertEquals(SaveProblem.Changed, refused.editor?.problem)
            assertEquals("Mine", refused.editor?.text, "the doctor's text is kept")
            holder.cancelEditing()
            val fresh =
                holder.state.first {
                    it is PatientNotesState.Loaded && it.editor == null &&
                        it.summary?.version == 5L
                }
            assertIs<PatientNotesState.Loaded>(fresh)
        }

    @Test
    fun other_save_failures_keep_the_text() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(notes()) })
            backend.on(save, { apiError(HttpStatusCode.Forbidden, "forbidden") })
            val holder = holder(backend)
            holder.loaded()
            holder.startEditing()
            holder.edit("Mine")
            holder.save()
            val failed =
                holder.state.first {
                    it is PatientNotesState.Loaded && it.editor?.problem != null
                } as PatientNotesState.Loaded
            assertEquals(SaveProblem.Failed(ScreenError.NotAllowed), failed.editor?.problem)
            assertNotNull(failed.editor)
            assertEquals("Mine", failed.editor.text)
        }

    @Test
    fun a_patient_out_of_reach_is_not_found() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.NotFound, "not_found") })
            val failed = holder(backend).state.first { it is PatientNotesState.Failed } as PatientNotesState.Failed
            assertEquals(ScreenError.NotFound, failed.error)
        }
}
