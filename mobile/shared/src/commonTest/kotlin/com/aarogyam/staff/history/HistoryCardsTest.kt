package com.aarogyam.staff.history

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun card(
    id: String,
    at: String,
    complaint: String? = null,
    bills: String = "null",
) = """{"id":"$id","number":"V-$id","status":"closed","started_at":"$at","clinician":{"id":"m1","name":"Dr. Rao"},
    "chief_complaint":${complaint?.let { "\"$it\"" } ?: "null"},
    "teeth":[{"tooth":36,"work":"done","label":"Filling"},{"tooth":26,"work":"planned","finding":"Caries"}],
    "images":[],"image_count":2,"note_first_line":"  Sensitive to cold  ","medicines":["Amoxicillin 500"],
    "bills":$bills,"plans":[{"id":"pl1","title":"Upper RCT","status":"accepted"}],
    "counts":{"notes":1,"recordings":0,"files":2,"procedures":1}}"""

private fun page(
    cursor: String?,
    vararg cards: String,
) = """{"visits":${cards.joinToString(
    ",",
    "[",
    "]",
)},"loose_files":[],"next_cursor":${cursor?.let { "\"$it\"" } ?: "null"}}"""

class HistoryCardsTest {
    private val route = "$SUNRISE/api/v1/patients/p1/history"
    private val perms = listOf("patients.read", "clinical.read", "billing.read")

    @Test
    fun one_history_call_fills_the_cards_and_load_more_appends() =
        runTest {
            val backend = FakeBackend()
            val bills =
                """[{"id":"b1","status":"issued","total_paise":8000,"paid_paise":2000},""" +
                    """{"id":"b2","status":"void","total_paise":900,"paid_paise":0}]"""
            backend.on(
                route,
                { json(page("c1", card("v2", "2026-10-01T04:30:00Z", bills = bills))) },
                { json(page(null, card("v1", "2026-09-01T04:30:00Z", complaint = "Pain"))) },
            )
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.visitHistory(openClinic(backend, graph, this, perms), "p1", backgroundScope)
            val first = holder.state.first { it is VisitHistoryState.Loaded } as VisitHistoryState.Loaded
            val v2 = first.rows.single()
            assertTrue(first.hasMore)
            assertEquals(listOf(26, 36), v2.teeth)
            assertEquals(ToothWorkKind.Done, v2.work.first().kind)
            assertEquals("Caries", v2.work[1].label)
            assertEquals("Sensitive to cold", v2.noteLine)
            assertEquals(listOf("Amoxicillin 500"), v2.medicines)
            assertEquals(2, v2.photoCount)
            assertEquals(BillState.Due, v2.bill)
            assertEquals(6000L, v2.duePaise)
            assertEquals("Filling", v2.titleSource.firstProcedure)
            assertNull(v2.titleSource.kind)
            assertEquals(0, backend.count("$SUNRISE/api/v1/patients/p1/visits"))

            holder.loadMore()
            val second =
                holder.state.first {
                    it is VisitHistoryState.Loaded && it.rows.size == 2
                } as VisitHistoryState.Loaded
            assertFalse(second.hasMore)
            assertEquals("Pain", second.rows[1].titleSource.complaint)
            assertEquals(BillState.None, second.rows[1].bill)
            assertTrue(
                backend.requests
                    .last()
                    .url.parameters["before"] == "c1",
            )
        }

    @Test
    fun a_server_without_history_falls_back_to_the_visit_list() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/patients/p1/visits",
                { json(items(visitJson("v1", "2026-09-01T04:30:00Z", complaint = "Pain"))) },
            )
            backend.on("$SUNRISE/api/v1/patients/p1/prescriptions", { json(items()) })
            backend.on("$SUNRISE/api/v1/patients/p1/procedures", { json(items()) })
            val graph = testGraph(backend, backgroundScope)
            val holder =
                graph.visitHistory(
                    openClinic(backend, graph, this, listOf("patients.read", "clinical.read")),
                    "p1",
                    backgroundScope,
                )
            val loaded = holder.state.first { it is VisitHistoryState.Loaded } as VisitHistoryState.Loaded
            assertEquals("v1", loaded.rows.single().id)
            assertFalse(loaded.hasMore)
        }
}
