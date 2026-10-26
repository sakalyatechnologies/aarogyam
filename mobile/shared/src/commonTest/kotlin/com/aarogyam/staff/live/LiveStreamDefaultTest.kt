package com.aarogyam.staff.live

import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.desk.until
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testConfig
import com.sakalya.mobile.auth.SessionState
import com.sakalya.mobile.core.MemoryLogSink
import com.sakalya.mobile.securestorage.InMemorySecureStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/** The event stream bills Cloud Run CPU while open, so the apps poll unless a build turns it on. */
class LiveStreamDefaultTest {
    private val events = "$SUNRISE/api/v1/events"

    private suspend fun TestScope.graph(
        backend: FakeBackend,
        liveStream: Boolean?,
    ): AppGraph {
        val config = testConfig()
        val store = InMemorySecureStore()
        val logs = MemoryLogSink()
        val made =
            if (liveStream == null) {
                AppGraph.create(config, store, backgroundScope, engine = backend.engine, logSink = logs)
            } else {
                AppGraph.create(
                    config,
                    store,
                    backgroundScope,
                    engine = backend.engine,
                    logSink = logs,
                    liveStream = liveStream,
                )
            }
        val graph = assertIs<AppGraph>(made)
        graph.sessions.state.first { it !is SessionState.Restoring }
        return graph
    }

    @Test
    fun the_default_graph_never_opens_the_stream() =
        runTest {
            val backend = FakeBackend()
            openClinic(backend, graph(backend, liveStream = null), this, listOf("appointments.read"))
            withContext(Dispatchers.Default) { delay(300) }
            assertEquals(0, backend.count(events))
        }

    @Test
    fun a_build_that_turns_it_on_opens_it_for_the_open_clinic() =
        runTest {
            val backend = FakeBackend()
            openClinic(backend, graph(backend, liveStream = true), this, listOf("appointments.read"))
            until { backend.count(events) > 0 }
        }
}
