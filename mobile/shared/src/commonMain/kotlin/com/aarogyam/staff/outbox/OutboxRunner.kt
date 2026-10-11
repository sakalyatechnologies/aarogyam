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
) {
    private val mutex = Mutex()
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val pendingCount = MutableStateFlow(count(OutboxStatus.Pending))
    private val failedList = MutableStateFlow(failedNow())

    /** Entries still to send, for the "Saved, will send" badge. */
    val pending: StateFlow<Int> = pendingCount.asStateFlow()

    /** Entries the server refused, kept for the screen. */
    val failed: StateFlow<List<OutboxEntry>> = failedList.asStateFlow()

    /** Saves a write and wakes the runner. Pass [id] to reuse one made earlier. */
    fun enqueue(
        kind: OutboxKind,
        payload: String,
        id: String = IdempotencyKey.generate().toString(),
    ): String {
        store.put(OutboxEntry(id = id, kind = kind, payload = payload, createdAt = now()))
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
        store.remove(id)
        publish()
    }

    /** Sends everything due, if online. Returns how many were delivered. */
    suspend fun drain(): Int =
        mutex.withLock {
            var delivered = 0
            if (!connectivity.online.value) return 0
            for (kind in OutboxKind.entries) {
                while (connectivity.online.value) {
                    val head =
                        store.all().firstOrNull { it.kind == kind && it.status == OutboxStatus.Pending }
                            ?: break
                    if (head.nextAttemptAt > now()) break
                    val result = send(head)
                    val next = settle(head, result)
                    if (result == SendResult.Delivered) delivered++
                    if (!next) break
                }
            }
            delivered
        }

    /** Runs until [scope] ends: drains at start, on enqueue, when the network returns, and when a retry is due. */
    fun start(scope: CoroutineScope): Job =
        scope.launch {
            launch { connectivity.online.collect { if (it) wake.trySend(Unit) } }
            while (true) {
                drain()
                val due = store.all().filter { it.status == OutboxStatus.Pending }.minOfOrNull { it.nextAttemptAt }
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

    /** Records the result; true when the next entry of the kind may go. */
    private fun settle(
        entry: OutboxEntry,
        result: SendResult,
    ): Boolean {
        val attempts = entry.attempts + 1
        val next =
            when (result) {
                SendResult.Delivered -> null
                is SendResult.Retry ->
                    entry.copy(attempts = attempts, nextAttemptAt = now() + backoff(attempts), lastError = result.code)
                is SendResult.Rejected ->
                    entry.copy(attempts = attempts, status = OutboxStatus.Failed, lastError = result.code)
            }
        if (next == null) store.remove(entry.id) else store.put(next)
        publish()
        return result !is SendResult.Retry
    }

    private fun backoff(attempts: Int): Long = min(maxDelayMillis, baseDelayMillis shl min(attempts - 1, MAX_SHIFT))

    private fun publish() {
        pendingCount.value = count(OutboxStatus.Pending)
        failedList.value = failedNow()
    }

    private fun count(status: OutboxStatus) = store.all().count { it.status == status }

    private fun failedNow() = store.all().filter { it.status == OutboxStatus.Failed }

    private companion object {
        const val MAX_SHIFT = 20
    }
}
