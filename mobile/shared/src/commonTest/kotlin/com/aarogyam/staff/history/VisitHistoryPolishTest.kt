package com.aarogyam.staff.history

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private fun procJson(
    id: String,
    visit: String,
    name: String,
    tooth: Int?,
    status: String = "done",
) = """{"id":"$id","visit_id":"$visit","clinician":{"id":"m1","name":"Dr. Patil"},"name":"$name","surfaces":[],
    "status":"$status","created_at":"2026-10-01T04:30:00Z","tooth":$tooth}"""

class VisitHistoryPolishTest {
    private val base = "$SUNRISE/api/v1/patients/p1"

    private fun FakeBackend.serve() {
        on(
            "$base/visits",
            {
                json(
                    items(
                        visitJson("v2", "2026-10-01T04:30:00Z", complaint = null),
                        visitJson("v1", "2026-09-01T04:30:00Z", complaint = "Pain"),
                    ),
                )
            },
        )
        on("$base/prescriptions", { json(items(rxJson("r1", "v2"))) })
        on(
            "$SUNRISE/api/v1/invoices",
            { json(items(invoiceJson("i2", "v2", 8000, 2000), invoiceJson("i1", "v1", 500, 500))) },
        )
        on(
            "$base/procedures",
            {
                json(
                    items(
                        procJson("a", "v2", "Filling", 36),
                        procJson("b", "v2", "RCT", 26),
                        procJson("c", "v2", "Filling again", 36),
                        procJson("d", "v2", "Mistake", 11, "entered_in_error"),
                    ),
                )
            },
        )
    }

    private suspend fun TestScope.load(permissions: List<String>): VisitHistoryState.Loaded {
        val backend = FakeBackend()
        backend.serve()
        val graph = testGraph(backend, backgroundScope)
        val holder = graph.visitHistory(openClinic(backend, graph, this, permissions), "p1", backgroundScope)
        return holder.state.first { it is VisitHistoryState.Loaded } as VisitHistoryState.Loaded
    }

    @Test
    fun teeth_due_and_title_source_come_from_the_visit() =
        runTest {
            val rows = load(listOf("patients.read", "clinical.read", "billing.read")).rows
            val (v2, v1) = rows
            assertEquals(listOf(26, 36), v2.teeth)
            assertEquals(6000L, v2.duePaise)
            assertNull(v2.titleSource.complaint)
            assertEquals("Filling again", v2.titleSource.firstProcedure)
            assertEquals(VisitKind.WalkIn, v2.titleSource.kind)
            assertEquals(0L, v1.duePaise)
            assertEquals("Pain", v1.titleSource.complaint)
        }

    @Test
    fun without_billing_there_is_no_due_and_without_clinical_no_teeth() =
        runTest {
            val rows = load(listOf("patients.read")).rows
            assertNull(rows[0].duePaise)
            assertEquals(emptyList(), rows[0].teeth)
            assertNull(rows[0].titleSource.firstProcedure)
        }
}
