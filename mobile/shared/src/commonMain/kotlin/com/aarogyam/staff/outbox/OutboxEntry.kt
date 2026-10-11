package com.aarogyam.staff.outbox

/** What a saved write does when it is sent. Entries of one kind are sent in the order they were saved. */
enum class OutboxKind { Note, Photo, Payment, VisitClose, NoteEdit, NoteSign, Procedure }

enum class OutboxStatus {
    /** Waiting to be sent, now or after [OutboxEntry.nextAttemptAt]. */
    Pending,

    /** The server refused it (4xx). Kept for the screen; never sent again unless the person retries. */
    Failed,
}

/**
 * One write saved on the phone.
 *
 * [id] is a client UUID v7 (`IdempotencyKey.generate().toString()`), chosen once when the write is
 * saved. The sender uses it as the record's client id (creates) or as the `Idempotency-Key`
 * (payments), so every retry, and a retry after an app restart, carries the same value.
 *
 * [payload] is JSON and holds patient data: it is never logged. [lastError] is a short code
 * (`offline`, `server_error`, `validation_failed`), never a message or a name.
 */
data class OutboxEntry(
    val id: String,
    val kind: OutboxKind,
    val payload: String,
    val createdAt: Long,
    val attempts: Int = 0,
    /** Epoch millis; the entry is not sent before this. */
    val nextAttemptAt: Long = 0,
    val status: OutboxStatus = OutboxStatus.Pending,
    val lastError: String? = null,
    /**
     * Writes that share a key go out strictly in the order they were saved, across kinds (a visit's
     * note, then its procedures, then its close). A `VisitClose` also waits for every other entry
     * of its key, however they were saved. Null: only the per-kind order applies.
     */
    val orderKey: String? = null,
    /** A newer pending entry with the same key replaces this one if it has not been sent yet (a note PATCH). */
    val coalesceKey: String? = null,
    /** Name of the image kept beside the queue in [OutboxFiles]; deleted once the entry is delivered or dropped. */
    val fileName: String? = null,
) {
    /** Leaves the payload out, so an entry in a log line or a crash report carries no patient data. */
    override fun toString(): String =
        "OutboxEntry(id=$id, kind=$kind, status=$status, attempts=$attempts, error=$lastError)"
}
