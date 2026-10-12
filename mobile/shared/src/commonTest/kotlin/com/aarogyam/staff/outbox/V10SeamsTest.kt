package com.aarogyam.staff.outbox

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.request.HttpRequestData
import io.ktor.http.content.TextContent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private class StringFile(
    var text: String?,
) : OutboxFile {
    override fun read() = text

    override fun writeAtomically(text: String) {
        this.text = text
    }

    override fun moveAside() {
        text = null
    }
}

private fun HttpRequestData.text() = (body as TextContent).text

class V10SeamsTest {
    private val visit = """{"id":"v1","number":"V-318","patient_id":"p1","status":"open","started_at":"2026-10-09T04:30:00Z",
        "clinician":{"id":"m1","name":"Dr. Patil"}}"""
    private val finish = "$SUNRISE/api/v1/visits/v1/finish"

    @Test
    fun the_new_kinds_are_saved_and_decoded_from_the_persisted_file() {
        val file =
            StringFile(
                """{"version":1,"entries":[
                {"id":"a","kind":"PatientFile","payload":"{}","createdAt":1},
                {"id":"b","kind":"Audio","payload":"{}","createdAt":2},
                {"id":"c","kind":"VisitClose","payload":"{}","createdAt":3}]}""",
            )
        val store = PersistentOutboxStore(JsonOutboxPersistence(file))
        assertEquals(
            listOf(OutboxKind.PatientFile, OutboxKind.Audio, OutboxKind.VisitClose),
            store.all().map { it.kind },
        )
        store.put(store.all().first().copy(attempts = 1))
        assertEquals(OutboxKind.PatientFile, PersistentOutboxStore(JsonOutboxPersistence(file)).all().first().kind)
    }

    @Test
    fun the_stub_senders_keep_their_entries_waiting_with_a_typed_code() =
        runTest {
            val entry = OutboxEntry("a", OutboxKind.PatientFile, "{}", 1)
            val files = MemoryOutboxFiles()
            assertEquals(SendResult.Retry(NOT_BUILT_YET), PatientFileSender({ null }, files).send(entry))
            assertEquals(
                SendResult.Retry(NOT_BUILT_YET),
                AudioSender({ null }, files).send(entry.copy(kind = OutboxKind.Audio)),
            )
        }

    @Test
    fun a_close_saved_by_an_older_build_is_sent_as_finish() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                finish,
                {
                    json(
                        """{"signed_note_ids":[],"unsigned_note_ids":[],"visit":${visit.replace(
                            "\"open\"",
                            "\"closed\"",
                        )}}""",
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("clinical.write"))
            val sender = VisitWriteSender({ clinic }, MemoryOutboxFiles())
            // The exact payload shape the v9 build saved: it carries `reason`, which finish calls `note`.
            val old =
                """{"clinicSlug":"${clinic.slug}","visitId":"v1","patientId":"p1","followUpOn":"2026-10-20","reason":"Review the filling","feePaise":150000}"""
            val result = sender.send(OutboxEntry("e1", OutboxKind.VisitClose, old, 1))
            assertEquals(SendResult.Delivered, result)
            val body = backend.requests.last { it.url.encodedPath.endsWith("/finish") }.text()
            assertTrue(""""follow_up_on":"2026-10-20"""" in body, body)
            assertTrue(""""note":"Review the filling"""" in body, body)
            assertTrue(""""fee_paise":150000""" in body, body)
            assertTrue(""""queue_status":"ready_to_bill"""" in body, body)
            assertTrue(
                "follow_up_reason" !in body && "close" !in
                    backend.requests
                        .last()
                        .url.encodedPath,
                body,
            )
            // An empty close of the old build (payload `{...}` with no extras) also finishes, ready to bill.
            val bare = """{"clinicSlug":"${clinic.slug}","visitId":"v1","patientId":"p1"}"""
            assertEquals(SendResult.Delivered, sender.send(OutboxEntry("e2", OutboxKind.VisitClose, bare, 2)))
            val second = backend.requests.last { it.url.encodedPath.endsWith("/finish") }.text()
            assertTrue(""""queue_status":"ready_to_bill"""" in second && "fee_paise" !in second, second)
        }
}
