package com.aarogyam.staff.outbox

/** Where saved writes live. Order is the order they were first saved. */
interface OutboxStore {
    /** Every entry, oldest first. */
    fun all(): List<OutboxEntry>

    /** Adds [entry], or replaces the one with the same id in place. */
    fun put(entry: OutboxEntry)

    fun remove(id: String)
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
}

/**
 * The platform hook: a file (Android, iOS) that survives the app being killed. Implementations
 * write atomically and rely on file-based encryption / Data Protection. TODO: the Android and iOS
 * implementations; until then [MemoryOutboxStore] loses unsent writes when the app is killed.
 */
interface OutboxPersistence {
    fun load(): List<OutboxEntry>

    fun save(entries: List<OutboxEntry>)
}

/** A [MemoryOutboxStore] that loads from, and saves after every change to, an [OutboxPersistence]. */
class PersistentOutboxStore(
    private val persistence: OutboxPersistence,
) : MemoryOutboxStore(persistence.load()) {
    override fun put(entry: OutboxEntry) {
        super.put(entry)
        persistence.save(all())
    }

    override fun remove(id: String) {
        super.remove(id)
        persistence.save(all())
    }
}
