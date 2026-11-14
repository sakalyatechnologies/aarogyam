package com.aarogyam.staff.outbox

import com.aarogyam.staff.api.PATIENT_PHOTO_MAX_BYTES
import com.aarogyam.staff.api.setConsentSignature
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
    /** For a signature: the consents the walk-in just recorded, each linked to the file once it is up (G10). */
    val consentIds: List<String> = emptyList(),
)

/**
 * Sends [OutboxKind.PatientFile] entries: the `photo` kind (Profile) goes to `PUT /patients/{id}/photo`
 * (field `file`, 2 MB at most, else rejected as `photo_too_large`); the others as `POST /patients/{id}/attachments` with the kind and label,
 * the entry id as the client id (so a retry returns the stored file). A signature is then linked to each
 * of [PatientFileJob.consentIds]. The whole item is retried; the file is deleted once the server has it
 * and every link is settled. After a restart the clinic is not open until the
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
        if (job.kind == "photo") {
            // The profile picture is the patient's one photo, not a file in the chart: `PUT /photo`.
            if (bytes.size > PATIENT_PHOTO_MAX_BYTES) return SendResult.Rejected("photo_too_large")
            return when (val answer = clinic.api.putPatientPhoto(job.patientId, bytes)) {
                is Outcome.Success -> {
                    runCatching { files.delete(name) }
                    SendResult.Delivered
                }

                is Outcome.Failure -> {
                    log.warn("patientfile.photo_failed") { code("error", answer.error.code.value) }
                    answer.toSendResult()
                }
            }
        }
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
                val linked = link(clinic, job, answer.value.id)
                if (linked is SendResult.Retry) return linked
                runCatching { files.delete(name) }
                SendResult.Delivered
            }

            is Outcome.Failure -> {
                log.warn("patientfile.upload_failed") { code("error", answer.error.code.value) }
                answer.toSendResult()
            }
        }
    }

    /**
     * Links the uploaded signature to each consent. A network failure retries the whole item (the upload
     * comes back as the same file); a refusal (already set, withdrawn, unknown) is final and logged by code.
     */
    private suspend fun link(
        clinic: ClinicContext,
        job: PatientFileJob,
        attachmentId: String,
    ): SendResult {
        for (consentId in job.consentIds) {
            val answer = clinic.api.setConsentSignature(job.patientId, consentId, attachmentId)
            if (answer is Outcome.Failure) {
                val result = answer.toSendResult()
                if (result is SendResult.Retry) return result
                log.warn("patientfile.signature_link_failed") { code("error", answer.error.code.value) }
            }
        }
        return SendResult.Delivered
    }
}
