package com.aarogyam.staff.outbox

import com.aarogyam.staff.api.model.NewNote
import com.aarogyam.staff.api.model.NewProcedure
import com.aarogyam.staff.api.model.NoteContent
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Outcome
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** Why a write was not saved on the phone. Nothing is dropped: the person is told and decides. */
enum class Refusal {
    /** Queued images would pass [OUTBOX_FILES_MAX_BYTES]. Send or discard some first. */
    FilesFull,

    /** The queue holds [OUTBOX_MAX_ENTRIES] writes that cannot be dropped. */
    QueueFull,
}

sealed interface Queued {
    data class Saved(
        val id: String,
    ) : Queued

    data class Refused(
        val why: Refusal,
    ) : Queued
}

/** What the visit and file holders use to save a write for later: one place that builds each payload. */
class WriteQueue(
    val runner: OutboxRunner,
    private val files: OutboxFiles,
    private val connectivity: Connectivity,
    private val maxFileBytes: Long = OUTBOX_FILES_MAX_BYTES,
) {
    /** True while the phone has a network. */
    val online: Boolean get() = connectivity.online.value

    /** The key that keeps one visit's writes in order. */
    fun visitKey(visitId: String): String = "visit:$visitId"

    /** Whether the visit still has unsent writes, so the next one must queue behind them. */
    fun visitHasUnsent(visitId: String): Boolean = runner.hasUnsent(visitKey(visitId))

    /** A new note; [note].id is the client id and the entry id. */
    fun noteCreate(
        clinicSlug: String,
        visitId: String,
        note: NewNote,
    ): Queued =
        save(
            OutboxKind.Note,
            NoteJob(clinicSlug, visitId, note.id ?: IdempotencyKey.generate().toString(), note, null),
            note.id,
            visitKey(visitId),
        )

    /** A note PATCH; an older waiting PATCH for the same note is replaced. */
    fun noteEdit(
        clinicSlug: String,
        visitId: String,
        noteId: String,
        content: NoteContent,
    ): Queued =
        save(
            OutboxKind.NoteEdit,
            NoteJob(clinicSlug, visitId, noteId, null, content),
            null,
            visitKey(visitId),
            coalesce = "note:$noteId",
        )

    fun noteSign(
        clinicSlug: String,
        visitId: String,
        noteId: String,
    ): Queued = save(OutboxKind.NoteSign, NoteJob(clinicSlug, visitId, noteId, null, null), null, visitKey(visitId))

    fun procedure(
        clinicSlug: String,
        visitId: String,
        procedure: NewProcedure,
    ): Queued = save(OutboxKind.Procedure, ProcedureJob(clinicSlug, visitId, procedure), null, visitKey(visitId))

    /** Close, and the follow-up when [followUpOn] is set. Goes only after the visit's other writes. */
    fun close(
        clinicSlug: String,
        visitId: String,
        patientId: String,
        followUpOn: String?,
        reason: String?,
        feePaise: Long?,
    ): Queued =
        save(
            OutboxKind.VisitClose,
            CloseJob(clinicSlug, visitId, patientId, followUpOn, reason, feePaise),
            null,
            visitKey(visitId),
        )

    /** A photo or X-ray: the image goes to protected storage beside the queue and is deleted once sent. */
    fun photo(
        clinicSlug: String,
        patientId: String,
        id: String,
        jpeg: ByteArray,
        label: String?,
        tooth: Int?,
    ): Queued {
        val name = "$id.jpg"
        val held = runCatching { files.read(name)?.size ?: 0 }.getOrDefault(0)
        if (files.totalBytes() - held + jpeg.size > maxFileBytes) return Queued.Refused(Refusal.FilesFull)
        files.write(name, jpeg)
        val queued = save(OutboxKind.Photo, PhotoJob(clinicSlug, patientId, label, tooth), id, null, fileName = name)
        if (queued is Queued.Refused) runCatching { files.delete(name) }
        return queued
    }

    private fun save(
        kind: OutboxKind,
        job: Any,
        id: String?,
        orderKey: String?,
        coalesce: String? = null,
        fileName: String? = null,
    ): Queued =
        try {
            val json =
                when (job) {
                    is NoteJob -> queueJson.encodeToString(job)
                    is ProcedureJob -> queueJson.encodeToString(job)
                    is CloseJob -> queueJson.encodeToString(job)
                    is PhotoJob -> queueJson.encodeToString(job)
                    else -> error("unknown job")
                }
            val entryId = id ?: IdempotencyKey.generate().toString()
            Queued.Saved(runner.enqueue(kind, json, entryId, orderKey, coalesce, fileName))
        } catch (_: OutboxFullException) {
            Queued.Refused(Refusal.QueueFull)
        }
}

/** True for a failure the outbox would try again: no network, a server error, or a limit. */
fun ApiError.shouldQueue(): Boolean = Outcome.Failure(this).toSendResult() is SendResult.Retry

internal val queueJson = Json { ignoreUnknownKeys = true }

/** Note writes. Hold clinical text: never logged. */
@Serializable
internal data class NoteJob(
    val clinicSlug: String,
    val visitId: String,
    val noteId: String,
    val create: NewNote? = null,
    val edit: NoteContent? = null,
)

@Serializable
internal data class ProcedureJob(
    val clinicSlug: String,
    val visitId: String,
    val procedure: NewProcedure,
)

@Serializable
internal data class CloseJob(
    val clinicSlug: String,
    val visitId: String,
    val patientId: String,
    val followUpOn: String? = null,
    val reason: String? = null,
    val feePaise: Long? = null,
)

@Serializable
internal data class PhotoJob(
    val clinicSlug: String,
    val patientId: String,
    val label: String? = null,
    val tooth: Int? = null,
)
