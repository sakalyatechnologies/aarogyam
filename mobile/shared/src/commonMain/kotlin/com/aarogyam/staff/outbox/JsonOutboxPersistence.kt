package com.aarogyam.staff.outbox

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * One file on the device, as the platform gives it. Implementations keep it in the app's private
 * storage (Android `filesDir`; iOS Application Support with `NSFileProtectionComplete`).
 */
interface OutboxFile {
    /** The text, or null when there is no file. Throws when the file exists but cannot be read. */
    fun read(): String?

    /** Writes a temporary file beside it, then renames it over the real one: never a half file. */
    fun writeAtomically(text: String)

    /** Renames the current file out of the way (kept for support, never read again). */
    fun moveAside()
}

@Serializable
private class EntryDto(
    val id: String,
    val kind: String,
    val payload: String,
    val createdAt: Long,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    val status: String = "Pending",
    val lastError: String? = null,
    val orderKey: String? = null,
    val coalesceKey: String? = null,
    val fileName: String? = null,
)

@Serializable
private class FileDto(
    val version: Int = 1,
    val entries: List<EntryDto> = emptyList(),
)

private val fileJson = Json { ignoreUnknownKeys = true }

/**
 * Saves the outbox as one JSON file through an [OutboxFile].
 *
 * **The payload is patient data** (a payment's patient and amount, a note's text). It is allowed in
 * this file only because the file lives in the app's protected private storage; it is never
 * logged, never copied to preferences, and the queue is emptied, and the file rewritten empty, on sign-out ([OutboxRunner.clear]).
 *
 * A file that does not parse is moved aside and the queue starts empty; this never throws. A file
 * that exists but cannot be read (a locked device) leaves the queue empty for this run and is
 * left alone: nothing is saved over it until the next start.
 */
class JsonOutboxPersistence(
    private val file: OutboxFile,
) : OutboxPersistence {
    private var readFailed = false

    override fun load(): List<OutboxEntry> {
        val text =
            try {
                file.read()
            } catch (_: Exception) {
                readFailed = true
                return emptyList()
            } ?: return emptyList()
        return try {
            fileJson.decodeFromString<FileDto>(text).entries.map {
                OutboxEntry(
                    id = it.id,
                    kind = OutboxKind.valueOf(it.kind),
                    payload = it.payload,
                    createdAt = it.createdAt,
                    attempts = it.attempts,
                    nextAttemptAt = it.nextAttemptAt,
                    status = OutboxStatus.valueOf(it.status),
                    lastError = it.lastError,
                    orderKey = it.orderKey,
                    coalesceKey = it.coalesceKey,
                    fileName = it.fileName,
                )
            }
        } catch (_: Exception) {
            runCatching { file.moveAside() }
            emptyList()
        }
    }

    override fun save(entries: List<OutboxEntry>) {
        if (readFailed) return
        val dto =
            FileDto(
                entries =
                    entries.map {
                        EntryDto(
                            it.id,
                            it.kind.name,
                            it.payload,
                            it.createdAt,
                            it.attempts,
                            it.nextAttemptAt,
                            it.status.name,
                            it.lastError,
                            it.orderKey,
                            it.coalesceKey,
                            it.fileName,
                        )
                    },
            )
        file.writeAtomically(fileJson.encodeToString(dto))
    }
}
