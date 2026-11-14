package com.aarogyam.staff.visit

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.desk.until
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class RecallsStateHolderTest {
    private fun recall(
        id: String,
        patient: String,
    ) =
        """{"id":"$id","patient":{"id":"$patient","name":"N","number":"SD-1"},"kind":"follow_up","reason":"r","due_on":"2026-10-20","status":"due"}"""

    @Test
    fun lists_only_this_patients_recalls_and_without_permission_asks_nothing() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/recalls",
                { json("""{"items":[${recall("c1", "p1")},${recall("c2", "p2")}]}""") },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("patients.read"))
            val holder = RecallsStateHolder(clinic, "p1", backgroundScope)
            holder.load()
            assertEquals(
                listOf("c1"),
                holder.state
                    .first { it.items.isNotEmpty() }
                    .items
                    .map { it.id },
            )
            val denied =
                RecallsStateHolder(openClinic(backend, graph, this, listOf("clinical.read")), "p1", backgroundScope)
            denied.load()
            assertEquals(1, backend.count("$SUNRISE/api/v1/recalls"))
        }

    private val route = "$SUNRISE/api/v1/recalls"
    private val dismissRoute = "$SUNRISE/api/v1/recalls/c1/dismiss"

    @Test
    fun dismiss_removes_the_row_and_sends_the_reason() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json("""{"items":[${recall("c1", "p1")},${recall("c2", "p1")}]}""") })
            backend.on(dismissRoute, { json(recall("c1", "p1").replace("\"due\"", "\"dismissed\"")) })
            val holder =
                RecallsStateHolder(
                    openClinic(backend, testGraph(backend, backgroundScope), this, listOf("patients.read")),
                    "p1",
                    backgroundScope,
                )
            holder.load()
            holder.state.first { it.items.size == 2 }
            holder.dismiss("c1", "seen elsewhere")
            assertEquals(
                listOf("c2"),
                holder.state
                    .first { it.items.size == 1 }
                    .items
                    .map { it.id },
            )
            assertEquals(1, backend.count(dismissRoute))
        }

    @Test
    fun dismiss_conflict_reloads_and_other_failures_keep_the_row() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json("""{"items":[${recall("c1", "p1")}]}""") })
            backend.on(dismissRoute, { apiError(HttpStatusCode.Conflict, "recall_closed") })
            val holder =
                RecallsStateHolder(
                    openClinic(backend, testGraph(backend, backgroundScope), this, listOf("patients.read")),
                    "p1",
                    backgroundScope,
                )
            holder.load()
            holder.state.first { it.items.size == 1 }
            holder.dismiss("c1")
            until { backend.count(route) == 2 }
            assertEquals(1, holder.state.value.items.size)
            backend.on(dismissRoute, { apiError(HttpStatusCode.Forbidden, "forbidden") })
            holder.dismiss("c1")
            assertNotNull(holder.state.first { it.error != null }.error)
            assertEquals(1, holder.state.value.items.size)
        }
}
