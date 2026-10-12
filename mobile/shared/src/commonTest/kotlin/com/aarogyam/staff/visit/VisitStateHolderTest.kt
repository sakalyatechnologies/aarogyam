package com.aarogyam.staff.visit

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.device.DictationLanguage
import com.aarogyam.staff.device.FakeDictation
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class VisitStateHolderTest {
    private val visit = """{"id":"v1","number":"V-318","patient_id":"p1","status":"open","started_at":"2026-10-09T04:30:00Z",
        "clinician":{"id":"m1","name":"Dr. Patil"}}"""

    private fun note(version: Int) =
        """{"id":"n1","visit_id":"v1","kind":"soap","source":"typed","status":"draft","sections":{},"author":{"id":"m1","name":"Dr. Patil"},
           "created_at":"2026-10-09T04:31:00Z","updated_at":"2026-10-09T04:31:00Z","row_version":$version,"addenda":[]}"""

    private fun HttpRequestData.text() = (body as TextContent).text

    private fun FakeBackend.serveNotes() {
        on("$SUNRISE/api/v1/visits/v1/notes", { json(note(1), HttpStatusCode.Created) })
        on("$SUNRISE/api/v1/notes/n1", { json(note(2)) })
        on("$SUNRISE/api/v1/notes/n1/sign", { json(note(3).replace("\"draft\"", "\"signed\"")) })
        on("$SUNRISE/api/v1/visits/v1/finish", {
            json("""{"signed_note_ids":[],"unsigned_note_ids":[],"visit":${visit.replace("\"open\"", "\"closed\"")}}""")
        })
    }

    @Test
    fun a_patient_without_a_token_starts_a_visit_directly() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/patients/p1/visits", { json(visit, HttpStatusCode.Created) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("clinical.write"))
            val holder = VisitStateHolder(clinic, "p1", null, "a1", FakeDictation(), backgroundScope)
            val open = holder.state.first { it is VisitState.Open } as VisitState.Open
            assertEquals("V-318", open.view.number)
            val body = backend.requests.last { it.url.encodedPath == "/api/v1/patients/p1/visits" }.text()
            assertTrue(""""appointment_id":"a1"""" in body && """"id":"""" in body, body)
        }

    @Test
    fun bullets_become_one_soap_note_created_once_then_edited_with_its_version() =
        runTest {
            val backend = FakeBackend().apply { serveNotes() }
            backend.on("$SUNRISE/api/v1/patients/p1/visits", { json(visit, HttpStatusCode.Created) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("clinical.write"))
            val holder = VisitStateHolder(clinic, "p1", null, null, FakeDictation(), backgroundScope)
            holder.state.first { it is VisitState.Open }
            holder.addBullet(BulletKind.Complaint, "Pain on 36 for 3 days")
            holder.addBullet(BulletKind.Finding, "Deep caries 36 O")
            holder.state.first { (it as? VisitState.Open)?.view?.save == NoteSave.Saved }
            assertEquals(1, backend.count("$SUNRISE/api/v1/visits/v1/notes"), "two quick bullets, one save")
            val created = backend.requests.last { it.url.encodedPath == "/api/v1/visits/v1/notes" }.text()
            assertTrue(
                """"subjective":"• Pain on 36 for 3 days"""" in created &&
                    """"objective":"• Deep caries 36 O"""" in created,
                created,
            )
            holder.addBullet(BulletKind.Advice, "RCT next visit")
            holder.state.first {
                (it as? VisitState.Open)?.view?.save == NoteSave.Saved &&
                    backend.count("$SUNRISE/api/v1/notes/n1") == 1
            }
            val edit = backend.requests.last { it.url.encodedPath == "/api/v1/notes/n1" }
            assertEquals("\"1\"", edit.headers["If-Match"])
            assertTrue(""""plan":"• RCT next visit"""" in edit.text())
            holder.sign()
            holder.state.first { (it as? VisitState.Open)?.view?.save == NoteSave.Signed }
            holder.close()
            holder.state.first { (it as? VisitState.Open)?.view?.closed == true }
        }

    @Test
    fun a_queued_patient_starts_from_the_token_and_dictation_adds_bullets() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/queue/t1/start-visit",
                {
                    json(
                        """{"visit":$visit,"created":true,"token":${com.aarogyam.staff.walkin.tokenJson(
                            "t1",
                            status = "in_chair",
                        )}}""",
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("clinical.write"))
            val dictation = FakeDictation()
            val holder = VisitStateHolder(clinic, "p1", "t1", null, dictation, backgroundScope)
            holder.state.first { it is VisitState.Open }
            holder.listen(DictationLanguage.Hindi)
            runCurrent()
            assertEquals(DictationLanguage.Hindi, dictation.listening)
            dictation.say("दांत में", "दांत में दर्द")
            runCurrent()
            val view = (holder.state.value as VisitState.Open).view
            assertEquals(listOf(Bullet(1, BulletKind.Dictated, "दांत में दर्द")), view.bullets)
            holder.retag(1, BulletKind.Finding)
            assertEquals(BulletKind.Finding, (holder.state.value as VisitState.Open).view.bullets[0].kind)
            dictation.stop()
            runCurrent()
            assertEquals(null, (holder.state.value as VisitState.Open).view.listening)
        }

    @Test
    fun a_failed_save_is_shown_and_close_waits_for_it() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/patients/p1/visits", { json(visit, HttpStatusCode.Created) })
            backend.on("$SUNRISE/api/v1/visits/v1/notes", { apiError(HttpStatusCode.InternalServerError, "internal") })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("clinical.write"))
            val holder = VisitStateHolder(clinic, "p1", null, null, FakeDictation(), backgroundScope)
            holder.state.first { it is VisitState.Open }
            holder.addBullet(BulletKind.Complaint, "Sensitivity")
            holder.close()
            val view =
                (
                    holder.state.first {
                        (it as? VisitState.Open)?.view?.save == NoteSave.Failed
                    } as VisitState.Open
                ).view
            assertTrue(!view.closed && view.error != null)
            assertEquals(0, backend.count("$SUNRISE/api/v1/visits/v1/finish"))
        }

    @Test
    fun without_clinical_write_no_visit_starts() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("clinical.read"))
            assertEquals(
                VisitState.NotAllowed,
                VisitStateHolder(clinic, "p1", null, null, FakeDictation(), backgroundScope).state.value,
            )
        }

    @Test
    fun sections_join_bullets_by_kind() {
        val s =
            sectionsOf(
                listOf(
                    Bullet(1, BulletKind.Dictated, " a "),
                    Bullet(2, BulletKind.Complaint, "b"),
                    Bullet(3, BulletKind.Advice, "  "),
                ),
            )
        assertEquals("• a\n• b", s.subjective)
        assertEquals(null, s.objective)
        assertEquals(null, s.plan)
    }
}
