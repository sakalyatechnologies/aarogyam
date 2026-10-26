package com.aarogyam.staff.outbox

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.respond
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

    private fun photoEntry(clinic: String) =
        OutboxEntry(
            id = "e2",
            kind = OutboxKind.PatientFile,
            payload = queueJson.encodeToString(PatientFileJob(clinic, "p9", "photo", "Profile")),
            createdAt = 1,
            fileName = "e2.jpg",
        )

    @Test
    fun the_profile_photo_goes_to_put_photo_in_the_field_file_and_the_signature_stays_an_attachment() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/patients/p9/photo", { respond("", HttpStatusCode.NoContent) })
            backend.on(UPLOAD, { json(STORED, HttpStatusCode.Created) })
            val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("patients.write"))
            files.write("e2.jpg", byteArrayOf(1, 2, 3))
            assertEquals(SendResult.Delivered, PatientFileSender({ clinic }, files).send(photoEntry(clinic.slug)))
            val put = backend.requests.single { it.method == HttpMethod.Put }
            assertTrue(put.url.encodedPath.endsWith("/patients/p9/photo"))
            assertTrue(
                """name=file""" in
                    put.body
                        .toByteArray()
                        .decodeToString()
                        .replace("\"", ""),
            )
            assertEquals(0, backend.uploads().size, "no attachment for the profile photo")
            assertTrue(files.names.isEmpty())
            assertEquals(SendResult.Delivered, PatientFileSender({ clinic }, files).send(entry(clinic.slug)))
            assertEquals(1, backend.uploads().size, "the signature is still an attachment")
        }

    @Test
    fun a_photo_over_2_mb_is_rejected_for_good_and_nothing_is_sent() =
        runTest {
            val backend = FakeBackend()
            val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("patients.write"))
            files.write("e2.jpg", ByteArray(2 * 1024 * 1024 + 1))
            assertEquals(
                SendResult.Rejected("photo_too_large"),
                PatientFileSender({ clinic }, files).send(photoEntry(clinic.slug)),
            )
            assertEquals(0, backend.requests.count { it.method == HttpMethod.Put })
        }
}
