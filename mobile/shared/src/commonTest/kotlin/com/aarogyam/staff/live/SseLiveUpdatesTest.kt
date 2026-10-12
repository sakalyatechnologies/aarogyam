package com.aarogyam.staff.live

import com.aarogyam.staff.PollingUpdates
import com.sakalya.mobile.core.LogLevel
import com.sakalya.mobile.core.LogRecord
import com.sakalya.mobile.core.LogSink
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.takeFrom
import io.ktor.utils.io.ByteChannel
import io.ktor.utils.io.close
import io.ktor.utils.io.writeStringUtf8
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The stream tests run in real time with short intervals: the mock engine delivers its bytes on its
 * own threads, so a virtual clock would race the body. Waits are bounded, never open-ended.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SseLiveUpdatesTest {
    private val heartbeat = 400L

    /** A scripted server: each connection takes the next answer; [requests] reports each one. */
    private class Server {
        val requests = Channel<HttpRequestData>(Channel.UNLIMITED)
        val answers = ArrayDeque<MockRequestHandleScope.() -> HttpResponseData>()
        var count = 0

        val client =
            HttpClient(
                MockEngine { request ->
                    count++
                    requests.trySend(request)
                    answers.removeFirst()(this)
                },
            ) {
                expectSuccess = false
                install(HttpTimeout) { requestTimeoutMillis = 30_000 }
                defaultRequest { url.takeFrom("https://sunrise.example/") }
            }

        /** Queues a live stream and returns the channel the test writes frames to. */
        fun stream(): ByteChannel {
            val channel = ByteChannel(autoFlush = true)
            answers += { respond(channel, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "text/event-stream")) }
            return channel
        }

        fun status(code: HttpStatusCode) {
            answers += { respond("", code) }
        }

        suspend fun nextRequest(): HttpRequestData = withTimeout(WAIT) { requests.receive() }
    }

    /** Fails a runaway reconnect loop instead of filling memory. */
    private val logs =
        object : LogSink {
            val memory = MemoryLogSink()
            val records get() = memory.records

            override fun write(record: LogRecord) {
                memory.write(record)
                check(memory.records.size < MAX_LOG_LINES) { "runaway reconnect loop" }
            }
        }

    private fun live() =
        SseLiveUpdates(
            log = Logger("test.live", logs, LogLevel.Debug),
            heartbeatTimeoutMillis = heartbeat,
            minBackoffMillis = 20,
            maxBackoffMillis = 160,
        )

    private fun realTime(body: suspend CoroutineScope.() -> Unit) =
        runTest {
            withContext(Dispatchers.Default) {
                coroutineScope {
                    body()
                    coroutineContext.job.cancelChildren()
                }
            }
        }

    private fun CoroutineScope.collectSignals(live: SseLiveUpdates): Channel<Unit> {
        val signals = Channel<Unit>(Channel.UNLIMITED)
        launch { live.signals.collect { signals.send(Unit) } }
        return signals
    }

    private suspend fun Channel<Unit>.await() = withTimeout(WAIT) { receive() }

    @Test
    fun an_event_is_dispatched_as_one_refresh() =
        realTime {
            val server = Server()
            val stream = server.stream()
            val live = live()
            val signals = collectSignals(live)
            delay(50)
            launch { live.run(server.client) }
            signals.await() // connected
            assertTrue(live.connected.value)

            stream.writeStringUtf8("event: ready\ndata: {}\n\n")
            stream.writeStringUtf8(": hb\n\n")
            stream.writeStringUtf8("event: queue.changed\ndata: {\"kind\":\"queue\",\"id\":\"q1\"}\n\n")
            signals.await()
            delay(100)
            // `ready` and the heartbeat made no refresh of their own: nothing else is waiting.
            assertTrue(signals.tryReceive().isFailure)
            val request = server.nextRequest()
            assertEquals("/api/v1/events", request.url.encodedPath)
            assertEquals("text/event-stream", request.headers[HttpHeaders.Accept])
            assertNull(request.headers["Last-Event-ID"])
        }

    @Test
    fun the_branch_goes_in_the_query() =
        realTime {
            val server = Server()
            server.stream()
            launch { live().run(server.client, branchId = "b1") }
            assertEquals("b1", server.nextRequest().url.parameters["branch_id"])
        }

    @Test
    fun reset_and_resync_each_refresh_even_without_data() =
        realTime {
            val server = Server()
            val stream = server.stream()
            val live = live()
            val signals = collectSignals(live)
            delay(50)
            launch { live.run(server.client) }
            signals.await()
            stream.writeStringUtf8("event: reset\n\n")
            signals.await()
            stream.writeStringUtf8("event: resync\ndata: {}\n\n")
            signals.await()
        }

    @Test
    fun a_reconnect_sends_the_last_event_id_and_refreshes() =
        realTime {
            val server = Server()
            val first = server.stream()
            val second = server.stream()
            val live = live()
            val signals = collectSignals(live)
            delay(50)
            launch { live.run(server.client) }
            signals.await()
            assertNull(server.nextRequest().headers["Last-Event-ID"])

            first.writeStringUtf8("id: 41\nevent: visit.changed\ndata: {}\n\n")
            signals.await()
            first.writeStringUtf8("id: 42\nevent: queue.changed\ndata: {}\n\n")
            signals.await()
            first.close() // the server went away

            assertEquals("42", server.nextRequest().headers["Last-Event-ID"])
            signals.await() // a refresh after the reconnect, with no event sent
            assertTrue(live.connected.value)
            second.close()
        }

    @Test
    fun no_heartbeat_means_dead_and_reconnects_but_comments_keep_it_alive() =
        realTime {
            val server = Server()
            val quiet = server.stream()
            server.stream()
            val live = live()
            launch { live.run(server.client) }
            server.nextRequest()
            live.connected.first { it }

            // Heartbeat comments every 150 ms: well past one timeout, still the same connection.
            repeat(6) {
                quiet.writeStringUtf8(": hb\n\n")
                delay(150)
            }
            assertEquals(1, server.count)
            assertTrue(live.connected.value)

            // Silence now: the connection is declared dead and a new one opens.
            server.nextRequest()
            assertEquals(2, server.count)
            assertTrue(logs.records.any { it.event == "live.heartbeat_lost" })
        }

    @Test
    fun a_401_stops_for_good() =
        realTime {
            val server = Server()
            server.status(HttpStatusCode.Unauthorized)
            val live = live()
            val job = launch { live.run(server.client) }
            withTimeout(WAIT) { job.join() }
            assertEquals(SseStop.Refused(401), live.stopped.value)
            assertFalse(live.connected.value)
            delay(400) // several backoff periods: no retry
            assertEquals(1, server.count)
        }

    @Test
    fun a_403_and_a_404_also_stop() =
        realTime {
            for (code in listOf(HttpStatusCode.Forbidden, HttpStatusCode.NotFound)) {
                val server = Server()
                server.status(code)
                val live = live()
                withTimeout(WAIT) { live.run(server.client) }
                assertEquals(SseStop.Refused(code.value), live.stopped.value)
            }
        }

    @Test
    fun a_server_error_is_retried_until_it_connects() =
        realTime {
            val server = Server()
            server.status(HttpStatusCode.BadGateway)
            server.status(HttpStatusCode.ServiceUnavailable)
            server.stream()
            val live = live()
            launch { live.run(server.client) }
            withTimeout(WAIT) { live.connected.first { it } }
            assertEquals(3, server.count)
            assertNull(live.stopped.value)
        }

    @Test
    fun sign_out_cancels_the_run_closes_the_stream_and_never_reconnects() =
        realTime {
            val server = Server()
            server.stream()
            server.stream()
            val live = live()
            val job = launch { live.run(server.client) }
            server.nextRequest()
            live.connected.first { it }
            job.cancel() // what the app does at sign-out or a clinic switch
            withTimeout(WAIT) { job.join() }
            assertFalse(live.connected.value)
            assertNull(live.stopped.value)
            delay(heartbeat + 200)
            assertEquals(1, server.count)
        }

    @Test
    fun a_new_run_after_a_clinic_switch_starts_without_the_old_last_event_id() =
        realTime {
            val server = Server()
            val first = server.stream()
            server.stream()
            val live = live()
            val signals = collectSignals(live)
            delay(50)
            val job = launch { live.run(server.client) }
            signals.await()
            first.writeStringUtf8("id: 9\nevent: queue.changed\ndata: {}\n\n")
            signals.await()
            job.cancel()
            job.join()
            server.nextRequest()
            launch { live.run(server.client) }
            assertNull(server.nextRequest().headers["Last-Event-ID"])
        }

    @Test
    fun backoff_grows_from_one_second_to_thirty_with_jitter_inside_the_range() {
        val live = SseLiveUpdates(log = Logger("test.live", logs), random = Random(7))
        val bases = listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L)
        bases.forEachIndexed { failures, base ->
            repeat(50) {
                val wait = live.backoffMillis(failures)
                assertTrue(wait in base / 2..base, "$failures -> $wait")
            }
        }
        assertTrue(live.backoffMillis(500) <= 30_000L)
    }

    @Test
    fun the_poll_stretches_to_120_seconds_only_while_connected() =
        runTest {
            val connected = MutableStateFlow(false)
            var ticks = 0
            backgroundScope.launch { PollingUpdates(connected = connected).changes().collect { ticks++ } }
            runCurrent()
            advanceTimeBy(PollingUpdates.POLL_MILLIS)
            runCurrent()
            assertEquals(1, ticks)
            connected.value = true
            runCurrent()
            advanceTimeBy(PollingUpdates.CONNECTED_POLL_MILLIS - 1)
            runCurrent()
            assertEquals(1, ticks)
            advanceTimeBy(1)
            runCurrent()
            assertEquals(2, ticks)
            connected.value = false
            runCurrent()
            advanceTimeBy(PollingUpdates.POLL_MILLIS)
            runCurrent()
            assertEquals(3, ticks)
        }

    @Test
    fun logs_carry_event_kinds_and_codes_never_the_payload() =
        realTime {
            val server = Server()
            val stream = server.stream()
            val live = live()
            val signals = collectSignals(live)
            delay(50)
            launch { live.run(server.client, branchId = "branch-secret") }
            signals.await()
            stream.writeStringUtf8(
                "id: patient-asha-patil\nevent: patient.asha.patil\ndata: {\"id\":\"ASHA PATIL 9876543210\"}\n\n",
            )
            signals.await()
            val text = logs.records.joinToString("\n") { it.format() }
            assertTrue("live.event" in text)
            for (secret in listOf("ASHA", "PATIL", "9876543210", "patient-asha", "branch-secret", "asha")) {
                assertFalse(secret in text, "logged $secret")
            }
        }

    private companion object {
        const val WAIT = 5_000L
        const val MAX_LOG_LINES = 200
    }
}
