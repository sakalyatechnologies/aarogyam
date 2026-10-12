package com.aarogyam.staff.outbox

/** Most bytes of queued images the phone keeps for unsent uploads. Over it, a new photo is refused, never an old one dropped. */
const val OUTBOX_FILES_MAX_BYTES: Long = 200L * 1024 * 1024

/**
 * Image files saved next to the queue. The platform keeps them in protected private storage
 * (iOS Application Support with `NSFileProtectionComplete`, Android `filesDir`). Names are opaque
 * (the entry id), never anything about the patient.
 */
interface OutboxFiles {
    fun write(
        name: String,
        bytes: ByteArray,
    )

    /** The bytes, or null when there is no such file. */
    fun read(name: String): ByteArray?

    fun delete(name: String)

    /** Total size of every stored file. */
    fun totalBytes(): Long
}

/** Files held in memory: the default until a platform store is passed, and for tests. */
class MemoryOutboxFiles(
    private val files: MutableMap<String, ByteArray> = mutableMapOf(),
) : OutboxFiles {
    override fun write(
        name: String,
        bytes: ByteArray,
    ) {
        files[name] = bytes
    }

    override fun read(name: String): ByteArray? = files[name]

    override fun delete(name: String) {
        files.remove(name)
    }

    override fun totalBytes(): Long = files.values.sumOf { it.size.toLong() }

    val names: Set<String> get() = files.keys.toSet()
}
