package com.aarogyam.staff.outbox

import com.sakalya.mobile.core.Logger
import kotlinx.coroutines.CancellationException

/** Where saved writes live. Order is the order they were first saved. */
interface OutboxStore {
    /** Every entry, oldest first. */
    fun all(): List<OutboxEntry>

    /** Adds [entry], or replaces the one with the same id in place. */
    fun put(entry: OutboxEntry)

    fun remove(id: String)

    /** Drops every entry. */
    fun clear()
}

/** Entries held in memory: the default until a platform store is passed, and for tests. */
open class MemoryOutboxStore(
    initial: List<OutboxEntry> = emptyList(),
) : OutboxStore {
    private val entries = LinkedHashMap<String, OutboxEntry>().apply { initial.forEach { put(it.id, it) } }

    override fun all(): List<OutboxEntry> = entries.values.toList()

    override fun put(entry: OutboxEntry) {
        entries[entry.id] = entry
    }

    override fun remove(id: String) {
        entries.remove(id)
    }

    override fun clear() {
        entries.clear()
    }
}

/** The most entries one store holds; see [PersistentOutboxStore]. */
const val OUTBOX_MAX_ENTRIES = 500

/** The queue is full of entries that cannot be dropped; the holder should tell the person. */
class OutboxFullException : IllegalStateException("outbox_full")

/**
 * The platform hook: something that keeps the entries across app restarts, normally a file
 * ([JsonOutboxPersistence]).
 */
interface OutboxPersistence {
    fun load(): List<OutboxEntry>

    fun save(entries: List<OutboxEntry>)
}

/**
 * A [MemoryOutboxStore] that loads from, and saves after every change to, an [OutboxPersistence].
 *
 * Holds at most [maxEntries]. A new entry over the limit first evicts the oldest failed one (the
 * server already refused it); if none is failed, [OutboxFullException] is thrown rather than
 * dropping a write the person expects to be sent. A save that fails (disk full) keeps the entry
 * in memory, so it still sends while the app runs; only the code is logged, never the entry.
 */
class PersistentOutboxStore(
    private val persistence: OutboxPersistence,
    private val maxEntries: Int = OUTBOX_MAX_ENTRIES,
    private val log: Logger = Logger("aarogyam.outbox"),
) : MemoryOutboxStore(persistence.load()) {
    override fun put(entry: OutboxEntry) {
        if (all().none { it.id == entry.id } && all().size >= maxEntries) {
            val evict = all().firstOrNull { it.status == OutboxStatus.Failed } ?: throw OutboxFullException()
            super.remove(evict.id)
        }
        super.put(entry)
        persist()
    }

    override fun remove(id: String) {
        super.remove(id)
        persist()
    }

    override fun clear() {
        super.clear()
        persist()
    }

    private fun persist() {
        try {
            persistence.save(all())
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            log.warn("outbox.save_failed")
        }
    }
}
