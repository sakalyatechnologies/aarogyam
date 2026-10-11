package com.aarogyam.staff.consents

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun consent(
    id: String,
    purpose: String,
    withdrawn: Boolean = false,
) = """{"id":"$id","purpose":"$purpose","notice_version":"v1 2026-10","notice_id":null,
  "given_at":"2026-10-02T20:00:00Z","method":"paper","recorded_by":"Asha",
  "status":"${if (withdrawn) "withdrawn" else "given"}",
  "withdrawn_at":${if (withdrawn) "\"2026-10-04T08:00:00Z\"" else "null"},"withdrawn_by":${if (withdrawn) "\"Asha\"" else "null"}}"""

private fun list(vararg items: String) = """{"items":${items.joinToString(",", "[", "]")}}"""

private const val NOTICES =
    """{"items":[{"id":"n1","version":1,"label":"v1 2026-10","body":"We keep your records.","published_at":"2026-10-01T00:00:00Z"}]}"""

class ConsentsStateHolderTest {
    private val consents = "$SUNRISE/api/v1/patients/p1/consents"
    private val notices = "$SUNRISE/api/v1/consent-notices"
    private val withdraw = "$SUNRISE/api/v1/consents/c1/withdraw"

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("patients.read", "patients.write"),
    ): ConsentsStateHolder {
        val graph = testGraph(backend, backgroundScope)
        return graph.consents(openClinic(backend, graph, this, permissions), "p1", backgroundScope)
    }

    private suspend fun ConsentsStateHolder.loaded() =
        state.first { it is ConsentsState.Loaded && !it.refreshing && !it.busy } as ConsentsState.Loaded

    private fun FakeBackend.base(vararg items: String) {
        on(consents, { json(list(*items)) })
        on(notices, { json(NOTICES) })
    }

    @Test
    fun groups_active_and_withdrawn() =
        runTest {
            val backend = FakeBackend()
            backend.base(consent("c1", "care"), consent("c2", "promotional", withdrawn = true))
            val loaded = holder(backend).loaded()
            assertEquals(listOf("c1"), loaded.active.map { it.id })
            assertEquals(listOf("c2"), loaded.withdrawn.map { it.id })
            assertEquals(ConsentPurpose.Care, loaded.active[0].purpose)
            assertEquals(ConsentMethod.Paper, loaded.active[0].method)
            assertEquals("v1 2026-10", loaded.active[0].noticeVersion)
            assertTrue(loaded.withdrawn[0].withdrawn)
            assertEquals(listOf("v1 2026-10"), loaded.notices.map { it.label })
            assertTrue(loaded.canRecord && loaded.canWithdraw)
        }

    @Test
    fun record_posts_with_a_key_and_reloads() =
        runTest {
            val backend = FakeBackend()
            backend.on(consents, { json(list()) }, { json(list()) }, { json(list(consent("c1", "care"))) })
            backend.on(notices, { json(NOTICES) })
            val h = holder(backend)
            h.loaded()
            backend.on(consents, { if (it.method == HttpMethod.Post) json(consent("c1", "care"), HttpStatusCode.Created) else json(list(consent("c1", "care"))) })
            h.record(ConsentPurpose.Care, ConsentMethod.Verbal)
            h.state.first { it is ConsentsState.Loaded && it.active.size == 1 }
            val post = backend.requests.last { it.method == HttpMethod.Post && it.url.encodedPath.endsWith("/consents") }
            assertNotNull(post.headers["Idempotency-Key"])
            assertTrue(post.body.toByteArray().decodeToString().contains("\"verbal\""))
            assertEquals(1, h.loaded().active.size)
        }

    @Test
    fun record_failure_keeps_the_input_and_the_key_for_the_retry() =
        runTest {
            val backend = FakeBackend()
            backend.base()
            val h = holder(backend)
            h.loaded()
            backend.on(consents, { if (it.method == HttpMethod.Post) apiError(HttpStatusCode.InternalServerError, "internal") else json(list()) })
            h.record(ConsentPurpose.Sharing, ConsentMethod.App, "asked")
            advanceUntilIdle()
            val failed = assertNotNull(h.loaded().failedRecord)
            assertEquals(ConsentPurpose.Sharing, failed.purpose)
            assertEquals("asked", failed.note)
            assertEquals(ScreenError.Server, failed.error)
            h.record(ConsentPurpose.Sharing, ConsentMethod.App, "asked")
            h.state.first { it is ConsentsState.Loaded && it.failedRecord != null }
            val keys = backend.requests.filter { it.method == HttpMethod.Post && it.url.encodedPath.endsWith("/consents") }.map { it.headers["Idempotency-Key"] }
            assertEquals(2, keys.size)
            assertEquals(keys[0], keys[1])
        }

    @Test
    fun withdraw_posts_and_reloads() =
        runTest {
            val backend = FakeBackend()
            backend.base(consent("c1", "care"))
            val h = holder(backend)
            h.loaded()
            backend.on(withdraw, { json(consent("c1", "care", withdrawn = true)) })
            backend.on(consents, { json(list(consent("c1", "care", withdrawn = true))) })
            h.withdraw("c1", ConsentMethod.Verbal)
            advanceUntilIdle()
            val loaded = h.loaded()
            assertTrue(loaded.active.isEmpty())
            assertEquals(1, loaded.withdrawn.size)
            assertEquals(1, backend.count(withdraw))
        }

    @Test
    fun without_patients_write_nothing_is_sent() =
        runTest {
            val backend = FakeBackend()
            backend.base(consent("c1", "care"))
            val h = holder(backend, listOf("patients.read"))
            assertEquals(false, h.loaded().canRecord)
            h.withdraw("c1", ConsentMethod.Paper)
            h.record(ConsentPurpose.Care, ConsentMethod.Paper)
            advanceUntilIdle()
            assertEquals(ScreenError.NotAllowed, h.loaded().error)
            assertEquals(0, backend.requests.count { it.method == HttpMethod.Post && it.url.encodedPath.contains("consent") })
        }

    @Test
    fun without_patients_read_it_is_not_allowed_and_asks_nothing() =
        runTest {
            val backend = FakeBackend()
            val h = holder(backend, listOf("appointments.read"))
            assertEquals(ConsentsState.NotAllowed, h.state.value)
            assertEquals(0, backend.count(consents))
        }

    @Test
    fun offline_shows_a_failure_and_a_reload_recovers() =
        runTest {
            val backend = FakeBackend()
            backend.on(consents, { throw kotlinx.io.IOException("offline") })
            backend.on(notices, { json(NOTICES) })
            val h = holder(backend)
            val failed = h.state.first { it is ConsentsState.Failed }
            assertIs<ConsentsState.Failed>(failed)
            assertTrue(failed.error == ScreenError.Offline || failed.error == ScreenError.Network)
            backend.on(consents, { json(list(consent("c1", "care"))) })
            h.refresh()
            assertEquals(1, h.loaded().active.size)
            assertNull(h.loaded().error)
        }
}
