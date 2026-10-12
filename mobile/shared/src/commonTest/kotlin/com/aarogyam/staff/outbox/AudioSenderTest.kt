package com.aarogyam.staff.outbox

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AudioSenderTest {
    private val route = "$SUNRISE/api/v1/patients/p1/attachments"
    private val attachment =
        """{"id":"e1","kind":"audio","mime_type":"audio/mp4","size_bytes":4,"sha256":"${"0".repeat(
            64,
        )}","created_at":"2026-10-12T05:00:00Z"}"""
    private val files = MemoryOutboxFiles()
    private val store = MemoryOutboxStore()
    private val runner = OutboxRunner(store, { SendResult.Delivered }, ManualConnectivity(false), { 1L }, files = files)

    private fun enqueue(
        bytes: ByteArray = byteArrayOf(1, 2, 3, 4),
        seconds: Int = 42,
        language: String? = "hi-IN",
    ) = enqueueAudio(runner, files, "sunrise", "p1", "v1", "n1", bytes, seconds, language)

    private suspend fun kotlinx.coroutines.test.TestScope.sender(backend: FakeBackend): AudioSender {
        val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("clinical.write"))
        return AudioSender({ clinic }, files)
    }

    private fun entryOf(id: String) = store.all().first { it.id == id }

    @Test
    fun the_upload_carries_the_audio_fields_and_the_entry_id_and_the_file_is_deleted_after() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(attachment, HttpStatusCode.Created) })
            val sender = sender(backend)
            val saved = assertIs<AudioEnqueue.Saved>(enqueue())
            val entry = entryOf(saved.id)
            assertEquals(1, files.names.size)
            assertEquals(SendResult.Delivered, sender.send(entry))
            val form =
                backend.requests
                    .single {
                        it.url.encodedPath.endsWith(
                            "/attachments",
                        )
                    }.body
                    .toByteArray()
                    .decodeToString()
            assertTrue("name=\"id\"" in form && saved.id in form, form)
            assertTrue("name=\"kind\"" in form && "audio" in form, form)
            assertTrue("name=\"note_id\"" in form && "n1" in form, form)
            assertTrue("name=\"duration_seconds\"" in form && "42" in form, form)
            assertTrue("name=\"language\"" in form && "hi-IN" in form, form)
            assertTrue("name=\"visit_id\"" in form, form)
            assertEquals(emptySet(), files.names)
        }

    @Test
    fun an_unsupported_language_is_sent_without_a_tag() =
        runTest {
            val saved = assertIs<AudioEnqueue.Saved>(enqueue(language = "gu-IN"))
            assertTrue("\"language\":null" in entryOf(saved.id).payload || "language" !in entryOf(saved.id).payload)
        }

    @Test
    fun a_failed_upload_retries_whole_and_keeps_the_file() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.BadGateway, "server_error") })
            val sender = sender(backend)
            val saved = assertIs<AudioEnqueue.Saved>(enqueue())
            assertIs<SendResult.Retry>(sender.send(entryOf(saved.id)))
            assertEquals(1, files.names.size)
        }

    @Test
    fun a_recording_over_the_caps_is_refused() =
        runTest {
            assertEquals(AudioEnqueue.TooLong, enqueue(seconds = AUDIO_MAX_SECONDS + 1))
            assertEquals(AudioEnqueue.TooLarge, enqueue(bytes = ByteArray(AUDIO_MAX_BYTES + 1)))
            assertEquals(emptySet(), files.names)
            // One that got into the queue another way (an older build) is rejected for good, with its file removed.
            val backend = FakeBackend()
            val sender = sender(backend)
            files.write("x.m4a", byteArrayOf(1))
            val job = AudioJob("sunrise", "p1", "v1", "n1", AUDIO_MAX_SECONDS + 1)
            val entry = OutboxEntry("x", OutboxKind.Audio, queueJson.encodeToString(job), 1, fileName = "x.m4a")
            assertEquals(SendResult.Rejected("audio_too_long"), sender.send(entry))
            assertNull(files.read("x.m4a"))
            assertEquals(0, backend.count(route))
            val big = ByteArray(AUDIO_MAX_BYTES + 1)
            files.write("y.m4a", big)
            val ok = job.copy(durationSeconds = 5)
            val bigEntry = OutboxEntry("y", OutboxKind.Audio, queueJson.encodeToString(ok), 1, fileName = "y.m4a")
            assertEquals(SendResult.Rejected("audio_too_large"), sender.send(bigEntry))
        }
}
