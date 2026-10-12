package com.aarogyam.staff.outbox

import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.model.Attachment
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.encodeURLPathPart
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

/** Longest voice note the API takes, in seconds (the web recorder stops at the same limit). */
const val AUDIO_MAX_SECONDS: Int = 600

/** Largest voice note file the API takes (`POST /patients/{id}/attachments`: up to 10 MB). */
const val AUDIO_MAX_BYTES: Int = 10 * 1024 * 1024

/** The audio payload of an [OutboxKind.Audio] entry. Holds ids only; the recording is the entry's file. Never logged. */
@Serializable
internal data class AudioJob(
    val clinicSlug: String,
    val patientId: String,
    val visitId: String? = null,
    val noteId: String? = null,
    val durationSeconds: Int,
    /** `en-IN`, `hi-IN` or `mr-IN`; null (no tag) for any other. */
    val language: String? = null,
    /** `audio/mp4`, `audio/webm` or `audio/ogg`. */
    val mimeType: String = "audio/mp4",
)

/** What [enqueueAudio] did. */
sealed interface AudioEnqueue {
    data class Saved(
        val id: String,
    ) : AudioEnqueue

    /** Longer than [AUDIO_MAX_SECONDS]: the API would refuse it, so it is not kept. */
    data object TooLong : AudioEnqueue

    /** Bigger than [AUDIO_MAX_BYTES]. */
    data object TooLarge : AudioEnqueue

    /** Kept recordings would pass [OUTBOX_FILES_MAX_BYTES]. */
    data object FilesFull : AudioEnqueue

    data object QueueFull : AudioEnqueue

    /** Empty file. */
    data object Empty : AudioEnqueue
}

/**
 * Saves a finished recording for upload. For the iOS recorder worker: call it once the recording
 * stops and its text has been saved to the note. The bytes go to protected storage beside the queue
 * (named by the entry id) and are deleted once sent.
 *
 * [noteId] is the note's client id, so the upload may be queued before the note itself is sent;
 * the sender waits for it. [language] is the dictation tag (`en-IN`, `hi-IN`, `mr-IN`); anything
 * else is sent without one, as on the web. Nothing is logged.
 */
fun enqueueAudio(
    runner: OutboxRunner,
    files: OutboxFiles,
    clinicSlug: String,
    patientId: String,
    visitId: String?,
    noteId: String?,
    bytes: ByteArray,
    durationSeconds: Int,
    language: String?,
    mimeType: String = "audio/mp4",
): AudioEnqueue {
    if (bytes.isEmpty()) return AudioEnqueue.Empty
    if (durationSeconds > AUDIO_MAX_SECONDS) return AudioEnqueue.TooLong
    if (bytes.size > AUDIO_MAX_BYTES) return AudioEnqueue.TooLarge
    if (files.totalBytes() + bytes.size > OUTBOX_FILES_MAX_BYTES) return AudioEnqueue.FilesFull
    val id = IdempotencyKey.generate().toString()
    val name = "$id.${extensionOf(mimeType)}"
    val job =
        AudioJob(clinicSlug, patientId, visitId, noteId, durationSeconds, language.takeIf { it in LANGUAGES }, mimeType)
    files.write(name, bytes)
    return try {
        // No order key: a recording that cannot go (slow network) must never hold the visit's finish back.
        AudioEnqueue.Saved(runner.enqueue(OutboxKind.Audio, queueJson.encodeToString(job), id, null, null, name))
    } catch (_: OutboxFullException) {
        runCatching { files.delete(name) }
        AudioEnqueue.QueueFull
    }
}

private val LANGUAGES = setOf("en-IN", "hi-IN", "mr-IN")

private fun extensionOf(mime: String): String =
    when (mime) {
        "audio/mp4" -> "m4a"
        "audio/ogg" -> "ogg"
        else -> "webm"
    }

/**
 * `POST /api/v1/patients/{id}/attachments` with `kind=audio`, the note it belongs to, its length
 * and spoken language, as the web does. [id] is the client UUID v7: a retry returns the stored
 * recording. The form carries a fixed file name, nothing about the patient.
 */
internal suspend fun ClinicApi.uploadAudio(
    patientId: String,
    id: String,
    job: AudioJob,
    bytes: ByteArray,
): Outcome<Attachment, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/patients/${patientId.encodeURLPathPart()}/attachments")
        setBody(
            MultiPartFormDataContent(
                formData {
                    append("id", id)
                    append("kind", "audio")
                    job.noteId?.let { append("note_id", it) }
                    job.visitId?.let { append("visit_id", it) }
                    append("duration_seconds", job.durationSeconds.toString())
                    job.language?.let { append("language", it) }
                    append(
                        "file",
                        bytes,
                        Headers.build {
                            append(HttpHeaders.ContentType, job.mimeType)
                            append(
                                HttpHeaders.ContentDisposition,
                                "filename=\"voice-note.${extensionOf(job.mimeType)}\"",
                            )
                        },
                    )
                },
            ),
        )
    }

/**
 * Sends [OutboxKind.Audio] entries: the whole recording in one request, so a failed upload is
 * retried whole (safe, the entry id is the idempotency key). A recording over [AUDIO_MAX_SECONDS]
 * or [AUDIO_MAX_BYTES] is refused for good. The file is deleted once the server has it. A missing
 * note (not sent yet) is waited for a few times. Only ids and codes are logged.
 */
internal class AudioSender(
    private val opened: (String) -> ClinicContext?,
    private val files: OutboxFiles,
    private val log: Logger = Logger("aarogyam.audio"),
) : OutboxSender {
    override suspend fun send(entry: OutboxEntry): SendResult {
        val job =
            try {
                queueJson.decodeFromString<AudioJob>(entry.payload)
            } catch (_: SerializationException) {
                return SendResult.Rejected("bad_payload")
            }
        val name = entry.fileName ?: return SendResult.Rejected("file_missing")
        val bytes = files.read(name) ?: return SendResult.Rejected("file_missing")
        if (job.durationSeconds > AUDIO_MAX_SECONDS) return refuse(name, "audio_too_long")
        if (bytes.size > AUDIO_MAX_BYTES) return refuse(name, "audio_too_large")
        val clinic = opened(job.clinicSlug) ?: return SendResult.Retry("clinic_not_open")
        return when (val answer = clinic.api.uploadAudio(job.patientId, entry.id, job, bytes)) {
            is Outcome.Success -> {
                runCatching { files.delete(name) }
                log.info("audio.sent") { id("entry", entry.id) }
                SendResult.Delivered
            }

            is Outcome.Failure -> {
                val status = answer.error.status
                log.warn("audio.failed") { code("error", answer.error.code.value) }
                // The note it belongs to may still be waiting in the queue.
                if ((status == NOT_FOUND || status == UNPROCESSABLE) && job.noteId != null &&
                    entry.attempts < NOTE_WAITS
                ) {
                    SendResult.Retry(answer.error.code.value)
                } else {
                    answer.toSendResult()
                }
            }
        }
    }

    private fun refuse(
        name: String,
        code: String,
    ): SendResult {
        runCatching { files.delete(name) }
        return SendResult.Rejected(code)
    }

    private companion object {
        const val NOT_FOUND = 404
        const val UNPROCESSABLE = 422
        const val NOTE_WAITS = 8
    }
}
