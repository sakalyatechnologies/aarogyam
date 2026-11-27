package com.aarogyam.staff.chart

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpMethod
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ToothTreatmentsTest {
    private val rights = listOf("patients.read", "clinical.read", "clinical.write")

    private fun procedure(
        id: String,
        tooth: Int,
        status: String,
    ) = """{"id":"$id","visit_id":"v1","clinician":{"id":"m1","name":"Dr A"},"name":"Filling","surfaces":["O"],
           "status":"$status","tooth":$tooth,"created_at":"2026-11-01T04:30:00Z"}"""

    @Test
    fun a_planned_treatment_is_done_with_a_tap_on_its_status() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/patients/p1/dental-chart",
                { json("""{"current":[],"history":[],"terms":[]}""") },
            )
            backend.on(
                "$SUNRISE/api/v1/patients/p1/procedures",
                {
                    json(
                        """{"items":[${procedure("a", 16, "planned")},${procedure("b", 16, "done")},
                           ${procedure("c", 26, "planned")}]}""",
                    )
                },
            )
            backend.on("$SUNRISE/api/v1/procedures/a/complete", { json(procedure("a", 16, "done")) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, rights)
            val chart = graph.chart(clinic, "p1", backgroundScope)
            chart.state.first { it is ChartState.Loaded }
            val sheet = graph.toothSheet(clinic, chart, "v1", backgroundScope)
            sheet.loadTreatments(16)
            val rows = sheet.treatmentRows.first { it.items.isNotEmpty() }
            assertEquals(listOf("a", "b"), rows.items.map { it.id }, "only this tooth's treatments")
            assertFalse(rows.items.first().done)
            sheet.completeTreatment("a")
            val after = sheet.treatmentRows.first { it.items.first().done && it.busy == null }
            assertTrue(after.items.all { it.done })
            assertEquals(
                1,
                backend.requests.count {
                    it.method == HttpMethod.Post &&
                        it.url.encodedPath.endsWith("/a/complete")
                },
            )
        }
}
