package com.aarogyam.staff.live

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.desk.until
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** T11: a new waiting, send-in or collect row raises one banner; old rows, handled rows and other kinds do not. */
class LiveBannerHolderTest {
    private val url = "$SUNRISE/api/v1/notifications"

    private fun row(
        id: String,
        kind: String,
        token: Int? = 7,
        handled: Boolean = false,
    ) = """{"id":"$id","kind":"$kind","created_at":"2026-10-08T04:00:00Z","read":false,
        "queue_token":${token?.let { """{"id":"t$it","number":$it}""" } ?: "null"},
        "handled":${if (handled) """{"at":"2026-10-08T04:01:00Z"}""" else "null"}}"""

    private fun items(vararg rows: String) = """{"items":${rows.joinToString(",", "[", "]")}}"""

    private class Rig(
        val backend: FakeBackend,
        val holder: LiveBannerHolder,
    )

    private suspend fun TestScope.rig(
        first: String,
        front: Boolean = true,
    ): Rig {
        val backend = FakeBackend()
        backend.on(url, { json(first) })
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, emptyList())
        val holder = LiveBannerHolder(clinic, backgroundScope, MutableStateFlow(front), periodMillis = 50)
        return Rig(backend, holder)
    }

    @Test
    fun the_first_load_only_remembers_what_is_there() =
        runTest {
            val r = rig(items(row("n1", "send_in")))
            until { r.backend.count(url) >= 2 }
            assertNull(r.holder.banner.value)
        }

    @Test
    fun a_new_send_in_raises_a_banner_with_its_token_and_is_not_raised_again() =
        runTest {
            val r = rig(items(row("n1", "task_assigned")))
            until { r.backend.count(url) >= 1 }
            r.backend.on(url, { json(items(row("n2", "send_in", token = 12), row("n1", "task_assigned"))) })
            until { r.holder.banner.value != null }
            assertEquals(LiveBanner("n2", "send_in", 12), r.holder.banner.value)
            r.holder.dismiss()
            val polls = r.backend.count(url)
            until { r.backend.count(url) >= polls + 2 }
            assertNull(r.holder.banner.value)
        }

    @Test
    fun handled_rows_and_other_kinds_raise_nothing() =
        runTest {
            val r = rig(items())
            until { r.backend.count(url) >= 1 }
            r.backend.on(
                url,
                { json(items(row("n3", "collect_payment", handled = true), row("n4", "task_assigned"))) },
            )
            val polls = r.backend.count(url)
            until { r.backend.count(url) >= polls + 2 }
            assertNull(r.holder.banner.value)
        }

    @Test
    fun nothing_is_asked_while_the_app_is_in_the_background() =
        runTest {
            val r = rig(items(), front = false)
            val before = r.backend.count(url)
            withContext(Dispatchers.Default) { delay(200) }
            assertEquals(before, r.backend.count(url))
            assertNull(r.holder.banner.value)
        }
}
