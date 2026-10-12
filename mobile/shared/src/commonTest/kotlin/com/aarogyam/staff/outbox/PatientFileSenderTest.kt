package com.aarogyam.staff.outbox

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.io.IOException
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private const val UPLOAD = "$SUNRISE/api/v1/patients/p9/attachments"
private const val STORED =
    """{"id":"e1","kind":"consent","mime_type":"image/png","size_bytes":3,"sha256":"0000000000000000000000000000000000000000000000000000000000000000",
    "label":"Signature","tooth":null,"created_at":"2026-10-12T04:00:00Z"}"""

class PatientFileSenderTest {
    private val files = MemoryOutboxFiles()

    private fun entry(clinic: String) =
        OutboxEntry(
            id = "e1",
            kind = OutboxKind.PatientFile,
            payload = queueJson.encodeToString(PatientFileJob(clinic, "p9", "consent", "Signature")),
            createdAt = 1,
            fileName = "e1.png",
        ).also { files.write("e1.png", byteArrayOf(1, 2, 3)) }

    private suspend fun FakeBackend.uploads() =
        requests
            .filter {
                it.method == HttpMethod.Post && it.url.encodedPath.endsWith("/attachments")
            }.map { it.body.toByteArray().decodeToString() }

    @Test
    fun the_upload_carries_the_id_kind_and_label_and_the_file_is_deleted_after() =
        runTest {
            val backend = FakeBackend()
            backend.on(UPLOAD, { json(STORED, HttpStatusCode.Created) })
            val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("clinical.write"))
            val result = PatientFileSender({ clinic }, files).send(entry(clinic.slug))
            assertEquals(SendResult.Delivered, result)
            val body = backend.uploads().single()
            assertTrue("""name="id"""" in body && "e1" in body)
            assertTrue("""name="kind"""" in body && "consent" in body)
            assertTrue("""name="label"""" in body && "Signature" in body)
            assertTrue(files.names.isEmpty(), "deleted after upload")
        }

    @Test
    fun a_failed_upload_retries_the_whole_item_with_the_same_id_and_keeps_the_file() =
        runTest {
            val backend = FakeBackend()
            backend.on(UPLOAD, { throw IOException("offline") }, { json(STORED, HttpStatusCode.Created) })
            val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("clinical.write"))
            val sender = PatientFileSender({ clinic }, files)
            val entry = entry(clinic.slug)
            assertTrue(sender.send(entry) is SendResult.Retry)
            assertEquals(setOf("e1.png"), files.names, "kept for the retry")
            assertEquals(SendResult.Delivered, sender.send(entry.copy(attempts = 1)))
            val bodies = backend.uploads()
            assertEquals(2, bodies.size)
            assertTrue(bodies.all { """name="id"""" in it && "e1" in it })
            assertTrue(files.names.isEmpty())
        }

    @Test
    fun a_closed_clinic_waits_and_a_missing_file_or_a_4xx_is_rejected() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                UPLOAD,
                { json("""{"error":{"code":"validation_failed"}}""", HttpStatusCode.UnprocessableEntity) },
            )
            val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("clinical.write"))
            val entry = entry(clinic.slug)
            assertEquals(SendResult.Retry("clinic_not_open"), PatientFileSender({ null }, files).send(entry))
            assertTrue(PatientFileSender({ clinic }, files).send(entry) is SendResult.Rejected)
            files.delete("e1.png")
            assertEquals(SendResult.Rejected("file_missing"), PatientFileSender({ clinic }, files).send(entry))
        }
}
