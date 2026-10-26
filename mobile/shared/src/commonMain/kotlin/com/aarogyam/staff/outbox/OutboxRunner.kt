package com.aarogyam.staff.outbox

import com.sakalya.mobile.core.IdempotencyKey
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.min

/**
 * Sends saved writes when the phone is online, and shows how many are waiting.
 *
 * **How a holder enqueues.** Build the request JSON, then `val id = runner.enqueue(kind, json)`;
 * show "Saved, will send" while [pending] is above zero, and list [failed] for entries the server
 * refused. Keep the returned id for records that refer to each other (a photo attached to an
 * offline note). Holders never retry or delay themselves; the runner does. The sender
 * ([OutboxSender]) is the only place that calls the API.
 *
 * **Rules.** Within one kind entries go out oldest first, and a waiting or backing-off entry holds
 * back the later ones of its kind (order matters for notes). Kinds do not wait for each other. A
 * network error or 5xx keeps the entry and schedules it again after `baseDelay * 2^attempts`, up to
 * [maxDelay], with the same id. A 4xx marks it failed and moves on. An entry leaves the store only
 * after the server accepted it, so a crash between sending and saving resends with the same id,
 * which the server answers with the first result.
 */
class OutboxRunner(
    private val store: OutboxStore,
    private val sender: OutboxSender,
    private val connectivity: Connectivity,
    private val now: () -> Long,
    private val baseDelayMillis: Long = 2_000,
    private val maxDelayMillis: Long = 300_000,
    private val files: OutboxFiles = MemoryOutboxFiles(),
) {
    private val mutex = Mutex()
    private var inFlight: String? = null
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val pendingCount = MutableStateFlow(count(OutboxStatus.Pending))
    private val failedList = MutableStateFlow(failedNow())
    private val idsNow = MutableStateFlow(store.all().map { it.id }.toSet())
    private val keysNow = MutableStateFlow(pendingKeys())

    /** Entries still to send, for the "Saved, will send" badge. */
    val pending: StateFlow<Int> = pendingCount.asStateFlow()

    /** Entries the server refused, kept for the screen. */
    val failed: StateFlow<List<OutboxEntry>> = failedList.asStateFlow()

    /** Ids of every entry still held (waiting, or refused and kept): a holder shows `pendingSync` while its id is here. */
    val ids: StateFlow<Set<String>> = idsNow.asStateFlow()

    /** Waiting entries per [OutboxEntry.orderKey], for a screen that shows how many of its writes are not sent. */
    val pendingByKey: StateFlow<Map<String, Int>> = keysNow.asStateFlow()

    /** Entries not sent yet, waiting or refused: what sign-out would lose. */
    fun unsentCount(): Int = store.all().size

    /** Whether anything with [orderKey] is still held, so a later write must queue behind it. */
    fun hasUnsent(orderKey: String): Boolean = store.all().any { it.orderKey == orderKey }

    /**
     * Saves a write and wakes the runner. Pass [id] to reuse one made earlier. A waiting entry with
     * the same [coalesceKey] is replaced (only the latest PATCH of a note is kept); [fileName] names
     * an image already written to the files, which goes with the entry. Throws [OutboxFullException]
     * when the queue is full.
     */
    fun enqueue(
        kind: OutboxKind,
        payload: String,
        id: String = IdempotencyKey.generate().toString(),
        orderKey: String? = null,
        coalesceKey: String? = null,
        fileName: String? = null,
    ): String {
        val entry =
            OutboxEntry(
                id = id,
                kind = kind,
                payload = payload,
                createdAt = now(),
                orderKey = orderKey,
                coalesceKey = coalesceKey,
                fileName = fileName,
            )
        if (coalesceKey != null) {
            // Not the one being sent right now: a send in progress finishes, and a newer one follows it.
            store
                .all()
                .filter { it.coalesceKey == coalesceKey && it.status == OutboxStatus.Pending && it.id != inFlight }
                .forEach { drop(it) }
        }
        store.put(entry)
        publish()
        wake.trySend(Unit)
        return id
    }

    /** Puts a failed entry back in line, for a "Try again" button. */
    fun retry(id: String) {
        store.all().firstOrNull { it.id == id && it.status == OutboxStatus.Failed }?.let {
            store.put(it.copy(status = OutboxStatus.Pending, nextAttemptAt = 0, lastError = null))
            publish()
            wake.trySend(Unit)
        }
    }

    /** Drops an entry, for a "Discard" button. */
    fun discard(id: String) {
        store.all().firstOrNull { it.id == id }?.let { drop(it) }
        publish()
    }

    private fun drop(entry: OutboxEntry) {
        store.remove(entry.id)
        entry.fileName?.let { runCatching { files.delete(it) } }
    }

    /**
     * Sign-out: drops every saved write, so one person's unsent writes never go out under the next
     * person's session. Waits for a send in progress to finish (it may still reach the server once).
     */
    suspend fun clear() {
        mutex.withLock {
            store.all().forEach { e -> e.fileName?.let { runCatching { files.delete(it) } } }
            store.clear()
            publish()
        }
    }

    /** Makes every waiting entry due now (the clinic it needs has just opened, or the person asked). */
    fun retryNow() {
        store.all().filter { it.status == OutboxStatus.Pending && it.nextAttemptAt > 0 }.forEach {
            store.put(it.copy(nextAttemptAt = 0))
        }
        wake.trySend(Unit)
    }

    /** Sends everything due, if online. Returns how many were delivered. */
    suspend fun drain(): Int =
        mutex.withLock {
            var delivered = 0
            while (connectivity.online.value) {
                val entries = store.all()
                val head =
                    entries
                        .withIndex()
                        .firstOrNull { (i, e) ->
                            e.status == OutboxStatus.Pending && e.nextAttemptAt <= now() && !blocked(entries, i)
                        }?.value ?: break
                inFlight = head.id
                val result = send(head)
                inFlight = null
                settle(head, result)
                if (result == SendResult.Delivered) delivered++
            }
            delivered
        }

    /**
     * An entry waits for the ones before it: without a key, for a waiting one of its kind; with a
     * key, for any earlier one of that key (a refused one too, so a close never goes without the
     * note it follows). A `VisitClose` also waits for every other entry of its key, saved later or not.
     */
    private fun blocked(
        entries: List<OutboxEntry>,
        index: Int,
    ): Boolean {
        val e = entries[index]
        val before = entries.subList(0, index)
        val key =
            e.orderKey
                ?: return before.any { it.orderKey == null && it.kind == e.kind && it.status == OutboxStatus.Pending }
        // An earlier close does not hold the writes it must wait for.
        return before.any {
            it.orderKey == key && !(it.kind == OutboxKind.VisitClose && e.kind != OutboxKind.VisitClose)
        } ||
            (e.kind == OutboxKind.VisitClose && entries.any { it.orderKey == key && it.kind != OutboxKind.VisitClose })
    }

    /** Runs until [scope] ends: drains at start, on enqueue, when the network returns, and when a retry is due. */
    fun start(scope: CoroutineScope): Job =
        scope.launch {
            launch { connectivity.online.collect { if (it) wake.trySend(Unit) } }
            while (true) {
                drain()
                val all = store.all()
                val due =
                    all
                        .filterIndexed { i, e -> e.status == OutboxStatus.Pending && !blocked(all, i) }
                        .minOfOrNull { it.nextAttemptAt }
                if (due == null || !connectivity.online.value) {
                    wake.receive()
                } else {
                    withTimeoutOrNull((due - now()).coerceAtLeast(1)) { wake.receive() }
                }
            }
        }

    private suspend fun send(entry: OutboxEntry): SendResult =
        try {
            sender.send(entry)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            SendResult.Retry("send_exception")
        }

    /** Records the result. An entry dropped or replaced while it was being sent is not brought back. */
    private fun settle(
        entry: OutboxEntry,
        result: SendResult,
    ) {
        val stillHeld = store.all().any { it.id == entry.id }
        val attempts = entry.attempts + 1
        val next =
            when (result) {
                SendResult.Delivered -> {
                    null
                }

                is SendResult.Retry -> {
                    entry.copy(attempts = attempts, nextAttemptAt = now() + backoff(attempts), lastError = result.code)
                }

                is SendResult.Rejected -> {
                    entry.copy(attempts = attempts, status = OutboxStatus.Failed, lastError = result.code)
                }
            }
        if (next == null) {
            drop(entry)
        } else if (stillHeld) {
            store.put(next)
        }
        publish()
    }

    private fun backoff(attempts: Int): Long = min(maxDelayMillis, baseDelayMillis shl min(attempts - 1, MAX_SHIFT))

    private fun publish() {
        pendingCount.value = count(OutboxStatus.Pending)
        failedList.value = failedNow()
        idsNow.value = store.all().map { it.id }.toSet()
        keysNow.value = pendingKeys()
    }

    private fun pendingKeys(): Map<String, Int> =
        store
            .all()
            .filter { it.status == OutboxStatus.Pending }
            .mapNotNull { it.orderKey }
            .groupingBy { it }
            .eachCount()

    private fun count(status: OutboxStatus) = store.all().count { it.status == status }

    private fun failedNow() = store.all().filter { it.status == OutboxStatus.Failed }

    private companion object {
        const val MAX_SHIFT = 20
    }
}
