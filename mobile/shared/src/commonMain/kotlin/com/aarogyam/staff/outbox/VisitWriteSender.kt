package com.aarogyam.staff.outbox

import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.CloseBody
import com.aarogyam.staff.api.addProcedure
import com.aarogyam.staff.api.closeVisit
import com.aarogyam.staff.api.createNote
import com.aarogyam.staff.api.editNote
import com.aarogyam.staff.api.signNote
import com.aarogyam.staff.api.visit
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.files.kindFor
import com.aarogyam.staff.visit.createRecallFor
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.ErrorCode
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.serialization.decodeFromString

/**
 * The one place that sends saved visit writes: notes, procedures, close and photos. Every retry
 * carries what makes it safe: the note's and the photo's client id; for the writes the server has
 * no key for (procedure, sign, close) a retry first checks what the server already holds.
 *
 * After an app restart the clinic is not open until the person opens it; the entry waits
 * (`clinic_not_open`) and goes the moment it is. Payloads are never logged.
 */
internal class VisitWriteSender(
    private val opened: (String) -> ClinicContext?,
    private val files: OutboxFiles,
    private val log: Logger = Logger("aarogyam.writes"),
) : OutboxSender {
    // Row versions this run knows, so a queued PATCH does not need a read first.
    private val versions = mutableMapOf<String, Long>()
    private val aliases = mutableMapOf<String, String>()

    override suspend fun send(entry: OutboxEntry): SendResult =
        try {
            when (entry.kind) {
                OutboxKind.Note -> note(entry)
                OutboxKind.NoteEdit -> edit(entry)
                OutboxKind.NoteSign -> sign(entry)
                OutboxKind.Procedure -> procedure(entry)
                OutboxKind.VisitClose -> close(entry)
                OutboxKind.Photo -> photo(entry)
                OutboxKind.Payment -> SendResult.Rejected("unsupported_kind")
            }
        } catch (_: kotlinx.serialization.SerializationException) {
            SendResult.Rejected("bad_payload")
        }

    private suspend fun note(entry: OutboxEntry): SendResult {
        val job = queueJson.decodeFromString<NoteJob>(entry.payload)
        val clinic = opened(job.clinicSlug) ?: return SendResult.Retry("clinic_not_open")
        val create = job.create ?: return SendResult.Rejected("bad_payload")
        return when (val answer = clinic.api.createNote(job.visitId, create)) {
            is Outcome.Success -> {
                versions[answer.value.id] = answer.value.rowVersion
                if (answer.value.id != job.noteId) aliases[job.noteId] = answer.value.id
                SendResult.Delivered
            }

            is Outcome.Failure -> {
                fail("write.note_failed", answer)
            }
        }
    }

    private suspend fun edit(entry: OutboxEntry): SendResult {
        val job = queueJson.decodeFromString<NoteJob>(entry.payload)
        val clinic = opened(job.clinicSlug) ?: return SendResult.Retry("clinic_not_open")
        val content = job.edit ?: return SendResult.Rejected("bad_payload")
        val id = aliases[job.noteId] ?: job.noteId
        var refreshed = false
        while (true) {
            val version =
                versions[id] ?: when (val read = rowVersion(clinic.api, job.visitId, id)) {
                    is Outcome.Success -> read.value
                    is Outcome.Failure -> return fail("write.note_read_failed", read)
                }
            when (val answer = clinic.api.editNote(id, version, content)) {
                is Outcome.Success -> {
                    versions[id] = answer.value.rowVersion
                    return SendResult.Delivered
                }

                is Outcome.Failure -> {
                    // A stale version (this device sent a PATCH whose answer was lost): read it once and go again.
                    val stale = answer.error.status == STALE_VERSION || answer.error.status == CONFLICT
                    if (!stale || refreshed) return fail("write.note_failed", answer)
                    versions.remove(id)
                    refreshed = true
                }
            }
        }
    }

    private suspend fun rowVersion(
        api: ClinicApi,
        visitId: String,
        noteId: String,
    ): Outcome<Long, ApiError> =
        when (val read = api.visit(visitId)) {
            is Outcome.Success -> {
                val found = read.value.notes.firstOrNull { it.id == noteId }
                if (found ==
                    null
                ) {
                    Outcome.Failure(ApiError.local(ErrorCode.UnexpectedResponse, "note_not_found"))
                } else {
                    Outcome.Success(found.rowVersion)
                }
            }

            is Outcome.Failure -> {
                Outcome.Failure(read.error)
            }
        }

    private suspend fun sign(entry: OutboxEntry): SendResult {
        val job = queueJson.decodeFromString<NoteJob>(entry.payload)
        val clinic = opened(job.clinicSlug) ?: return SendResult.Retry("clinic_not_open")
        return when (val answer = clinic.api.signNote(aliases[job.noteId] ?: job.noteId)) {
            is Outcome.Success -> {
                SendResult.Delivered
            }

            // Signed already: an earlier attempt reached the server and its answer was lost.
            is Outcome.Failure -> {
                if (entry.attempts > 0 &&
                    answer.error.status == CONFLICT
                ) {
                    SendResult.Delivered
                } else {
                    fail("write.sign_failed", answer)
                }
            }
        }
    }

    private suspend fun procedure(entry: OutboxEntry): SendResult {
        val job = queueJson.decodeFromString<ProcedureJob>(entry.payload)
        val clinic = opened(job.clinicSlug) ?: return SendResult.Retry("clinic_not_open")
        // The server has no key for procedures: a retry first looks for the one it may already hold.
        if (entry.attempts > 0) {
            val read = clinic.api.visit(job.visitId)
            if (read is Outcome.Failure) return fail("write.procedure_read_failed", read)
            val p = job.procedure
            val held =
                (read as Outcome.Success).value.procedures.any {
                    it.name == p.name && it.tooth?.toLong() == p.tooth && it.status == (p.status ?: "done") &&
                        it.note == p.note && it.surfaces == (p.surfaces ?: emptyList<String>())
                }
            if (held) return SendResult.Delivered
        }
        return when (val answer = clinic.api.addProcedure(job.visitId, job.procedure)) {
            is Outcome.Success -> SendResult.Delivered
            is Outcome.Failure -> fail("write.procedure_failed", answer)
        }
    }

    private suspend fun close(entry: OutboxEntry): SendResult {
        val job = queueJson.decodeFromString<CloseJob>(entry.payload)
        val clinic = opened(job.clinicSlug) ?: return SendResult.Retry("clinic_not_open")
        val closed = clinic.api.closeVisit(job.visitId)
        // Closed already: an earlier attempt got through (or its follow-up failed); carry on to the follow-up.
        if (closed is Outcome.Failure && !(entry.attempts > 0 && closed.error.status == CONFLICT)) {
            return fail("write.close_failed", closed)
        }
        val due = job.followUpOn ?: return SendResult.Delivered
        val failure =
            createRecallFor(clinic, job.patientId, due, job.reason ?: "follow_up") ?: return SendResult.Delivered
        return fail("write.follow_up_failed", Outcome.Failure(failure))
    }

    private suspend fun photo(entry: OutboxEntry): SendResult {
        val job = queueJson.decodeFromString<PhotoJob>(entry.payload)
        val clinic = opened(job.clinicSlug) ?: return SendResult.Retry("clinic_not_open")
        val name = entry.fileName ?: return SendResult.Rejected("file_missing")
        val bytes = files.read(name) ?: return SendResult.Rejected("file_missing")
        return when (
            val answer =
                clinic.api.uploadAttachment(
                    job.patientId,
                    entry.id,
                    kindFor(job.label),
                    bytes,
                    job.label,
                    job.tooth,
                )
        ) {
            is Outcome.Success -> SendResult.Delivered
            is Outcome.Failure -> fail("write.photo_failed", answer)
        }
    }

    private fun fail(
        event: String,
        failure: Outcome.Failure<ApiError>,
    ): SendResult {
        log.warn(event) { code("error", failure.error.code.value) }
        return failure.toSendResult()
    }

    private companion object {
        const val STALE_VERSION = 412
        const val CONFLICT = 409
    }
}
