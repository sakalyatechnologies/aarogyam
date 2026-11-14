package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ToCollectHolderTest {
    private val route = "$SUNRISE/api/v1/queue/to-collect"

    private fun item(
        id: String,
        balance: Long,
    ) =
        """{"token_id":"$id","day":"2026-10-30","token_number":4,"patient_id":"p1","patient_number":"SD-1","invoice_id":"i$id","balance_paise":$balance}"""

    private suspend fun kotlinx.coroutines.test.TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("payments.collect"),
    ) = ToCollectHolder(openClinic(backend, testGraph(backend, backgroundScope), this, permissions), backgroundScope)

    @Test
    fun loaded_carries_the_items_and_their_total() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json("""{"items":[${item("t1", 5000)},${item("t2", 2500)}]}""") })
            val holder = holder(backend)
            until { holder.state.value is ToCollectState.Loaded }
            val loaded = assertIs<ToCollectState.Loaded>(holder.state.value)
            assertEquals(listOf("t1", "t2"), loaded.items.map { it.tokenId })
            assertEquals(7500L, loaded.totalPaise)
        }

    @Test
    fun empty_list_is_loaded_with_a_zero_total() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json("""{"items":[]}""") })
            val holder = holder(backend, listOf("billing.read"))
            until { holder.state.value is ToCollectState.Loaded }
            assertEquals(0L, assertIs<ToCollectState.Loaded>(holder.state.value).totalPaise)
        }

    @Test
    fun failure_shows_failed_and_refresh_recovers() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.InternalServerError, "internal") })
            val holder = holder(backend)
            until { holder.state.value is ToCollectState.Failed }
            backend.on(route, { json("""{"items":[${item("t1", 100)}]}""") })
            holder.refresh()
            until { holder.state.value is ToCollectState.Loaded }
        }

    @Test
    fun a_role_without_the_permission_asks_nothing() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, listOf("appointments.read"))
            assertIs<ToCollectState.NotAllowed>(holder.state.value)
            holder.refresh()
            assertEquals(0, backend.count(route))
        }
}
