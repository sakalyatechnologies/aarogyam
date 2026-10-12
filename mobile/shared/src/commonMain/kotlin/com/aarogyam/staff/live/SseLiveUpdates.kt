package com.aarogyam.staff.live

import com.aarogyam.staff.LiveUpdates
import com.aarogyam.staff.PollingUpdates
import com.sakalya.mobile.core.Logger
import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeoutConfig
import io.ktor.client.plugins.timeout
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.prepareGet
import io.ktor.client.request.url
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.utils.io.readLine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.random.Random

/**
 * Live updates from the server's event stream (`GET api/v1/events`), with polling as the safety net.
 *
 * [run] holds one connection for as long as it is running (the app runs it while a clinic is open
 * and signed in, and cancels it on sign-out or a clinic switch). [changes] emits when the server says
 * something changed, after every (re)connect, and on `reset`/`resync`; it also carries the poll,
 * which slows to 120 s while the stream is [connected] (see [PollingUpdates]) and is 20 s otherwise.
 *
 * The stream carries ids only. Nothing from it is logged except the event kind and codes.
 */
class SseLiveUpdates(
    private val log: Logger = Logger("aarogyam.live"),
    private val random: Random = Random.Default,
    private val heartbeatTimeoutMillis: Long = HEARTBEAT_TIMEOUT_MILLIS,
    private val minBackoffMillis: Long = MIN_BACKOFF_MILLIS,
    private val maxBackoffMillis: Long = MAX_BACKOFF_MILLIS,
) : LiveUpdates {
    private val refreshes =
        MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    private val connectedState = MutableStateFlow(false)

    /** True while a stream is open; polling stretches while it is. */
    val connected: StateFlow<Boolean> = connectedState.asStateFlow()

    private val stoppedState = MutableStateFlow<SseStop?>(null)

    /** Why the last [run] ended by itself (not cancelled), or null; the app is then polling only. */
    val stopped: StateFlow<SseStop?> = stoppedState.asStateFlow()

    /** Only the stream's own signals (events, `reset`, every connect), without the poll. */
    val signals: Flow<Unit> = refreshes.asSharedFlow()

    override fun changes(): Flow<Unit> = merge(signals, PollingUpdates(connected = connected).changes())

    /**
     * Keeps a stream open on [client] until cancelled or the server refuses us (401, 403 and other
     * client errors except 408/429): then it returns and [stopped] says why. Reconnects with backoff.
     * [client] is the clinic's own client, so the bearer token is added and refreshed like any call.
     */
    suspend fun run(
        client: HttpClient,
        branchId: String? = null,
    ) {
        stoppedState.value = null
        var lastEventId: String? = null
        var failures = 0
        try {
            while (true) {
                currentCoroutineContext().ensureActive()
                val outcome = connectOnce(client, branchId, lastEventId) { lastEventId = it }
                connectedState.value = false
                when (outcome) {
                    is Ended.Refused -> {
                        log.warn("live.refused") { count("status", outcome.status.toLong()) }
                        stoppedState.value = SseStop.Refused(outcome.status)
                        return
                    }

                    // The connection was good and then ended or went quiet: start over from the shortest wait.
                    is Ended.Dropped -> {
                        failures = if (outcome.wasLive) 0 else failures + 1
                    }
                }
                val wait = backoffMillis(failures)
                log.info("live.reconnect") { count("wait_ms", wait) }
                delay(wait)
            }
        } finally {
            connectedState.value = false
        }
    }

    private suspend fun connectOnce(
        client: HttpClient,
        branchId: String?,
        lastEventId: String?,
        remember: (String?) -> Unit,
    ): Ended {
        var live = false
        try {
            var result: Ended = Ended.Dropped(false)
            client
                .prepareGet {
                    url("api/v1/events")
                    if (branchId != null) parameter("branch_id", branchId)
                    header(HttpHeaders.Accept, "text/event-stream")
                    header(HttpHeaders.CacheControl, "no-cache")
                    if (!lastEventId.isNullOrEmpty()) header("Last-Event-ID", lastEventId)
                    // The stream is long-lived: only our own heartbeat timer ends it.
                    timeout {
                        requestTimeoutMillis = HttpTimeoutConfig.INFINITE_TIMEOUT_MS
                        socketTimeoutMillis = HttpTimeoutConfig.INFINITE_TIMEOUT_MS
                    }
                }.execute { response ->
                    val status = response.status.value
                    if (status != HTTP_OK) {
                        result = if (isFinal(status)) Ended.Refused(status) else Ended.Dropped(false)
                        if (result is Ended.Dropped) log.warn("live.failed") { count("status", status.toLong()) }
                        return@execute
                    }
                    live = true
                    connectedState.value = true
                    log.info("live.connected") { flag("resumed", !lastEventId.isNullOrEmpty()) }
                    // Whatever was missed while away, and what `ready` would say: refetch now.
                    refreshes.tryEmit(Unit)
                    val parser = SseParser(lastEventId)
                    val channel = response.bodyAsChannel()
                    while (true) {
                        val read = withTimeoutOrNull(heartbeatTimeoutMillis) { Read(channel.readLine()) }
                        if (read == null) {
                            log.warn("live.heartbeat_lost") {}
                            break
                        }
                        // null line: the server closed the stream.
                        val line = read.line ?: break
                        val frame = parser.feed(line) ?: continue
                        remember(parser.lastEventId)
                        handle(frame)
                    }
                }
            return if (result is Ended.Refused) result else Ended.Dropped(live)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.warn("live.failed") { code("error", e::class.simpleName ?: "error") }
            return Ended.Dropped(live)
        }
    }

    private fun handle(frame: SseFrame) {
        val kind = frame.event
        // `ready` only says the stream is live; connecting already refreshed.
        if (kind == "ready") return
        log.info("live.event") { code("kind", if (kind in KNOWN) kind else "other") }
        refreshes.tryEmit(Unit)
    }

    /** Doubles from [minBackoffMillis] to [maxBackoffMillis], then keeps a random half to all of it. */
    internal fun backoffMillis(failures: Int): Long {
        var base = minBackoffMillis
        repeat(failures.coerceAtMost(MAX_DOUBLINGS)) { base = (base * 2).coerceAtMost(maxBackoffMillis) }
        return base / 2 + random.nextLong(base / 2 + 1)
    }

    private fun isFinal(status: Int): Boolean =
        status in 400..499 && status != HTTP_REQUEST_TIMEOUT && status != HTTP_TOO_MANY

    private class Read(
        val line: String?,
    )

    private sealed interface Ended {
        data class Refused(
            val status: Int,
        ) : Ended

        data class Dropped(
            val wasLive: Boolean,
        ) : Ended
    }

    companion object {
        const val HEARTBEAT_TIMEOUT_MILLIS = 60_000L
        const val MIN_BACKOFF_MILLIS = 1_000L
        const val MAX_BACKOFF_MILLIS = 30_000L
        private const val MAX_DOUBLINGS = 10
        private const val HTTP_OK = 200
        private const val HTTP_REQUEST_TIMEOUT = 408
        private const val HTTP_TOO_MANY = 429
        private val KNOWN = setOf("queue.changed", "visit.changed", "notification.created", "resync", "reset")
    }
}

/** Why the stream stopped by itself. */
sealed interface SseStop {
    /** The server answered [status] (401, 403, 404 ...): no point retrying, polling carries on. */
    data class Refused(
        val status: Int,
    ) : SseStop
}
