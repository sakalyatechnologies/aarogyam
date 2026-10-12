package com.aarogyam.staff.outbox

import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString

/** Kept for the stubs that still answer with it (the audio sender). */
const val NOT_BUILT_YET = "not_built_yet"

/** What a queued patient file says: who it is for and how it is filed. The bytes are in [OutboxFiles]. Never logged. */
@Serializable
internal data class PatientFileJob(
    val clinicSlug: String,
    val patientId: String,
    /** `photo` or `consent` (the attachment kind). */
    val kind: String,
    /** "Profile" or "Signature". */
    val label: String? = null,
)

/**
 * Sends [OutboxKind.PatientFile] entries: `POST /patients/{id}/attachments` with the kind and label,
 * the entry id as the client id (so a retry returns the stored file). The whole item is retried;
 * the file is deleted once the server has it. After a restart the clinic is not open until the
 * person opens it, so the entry waits (`clinic_not_open`). Nothing about the patient is logged.
 */
internal class PatientFileSender(
    private val opened: (String) -> ClinicContext?,
    private val files: OutboxFiles,
    private val log: Logger = Logger("aarogyam.patientfile"),
) : OutboxSender {
    override suspend fun send(entry: OutboxEntry): SendResult {
        val job =
            try {
                queueJson.decodeFromString<PatientFileJob>(entry.payload)
            } catch (_: kotlinx.serialization.SerializationException) {
                return SendResult.Rejected("bad_payload")
            }
        val clinic = opened(job.clinicSlug) ?: return SendResult.Retry("clinic_not_open")
        val name = entry.fileName ?: return SendResult.Rejected("file_missing")
        val bytes = files.read(name) ?: return SendResult.Rejected("file_missing")
        return when (
            val answer =
                clinic.api.uploadAttachment(
                    job.patientId,
                    entry.id,
                    job.kind,
                    bytes,
                    job.label,
                    null,
                )
        ) {
            is Outcome.Success -> {
                runCatching { files.delete(name) }
                SendResult.Delivered
            }

            is Outcome.Failure -> {
                log.warn("patientfile.upload_failed") { code("error", answer.error.code.value) }
                answer.toSendResult()
            }
        }
    }
}
