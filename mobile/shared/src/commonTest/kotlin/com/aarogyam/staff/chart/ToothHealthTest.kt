package com.aarogyam.staff.chart

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ToothHealthTest {
    private val route = "$SUNRISE/api/v1/patients/p1/dental-chart"
    private val readWrite = listOf("patients.read", "clinical.read", "clinical.write")

    private fun entry(
        id: String,
        tooth: Int,
        finding: String,
        surface: String? = null,
        elsewhere: Boolean = false,
    ) = """{"id":"$id","tooth":$tooth,"finding":"$finding","status":"current","effective_at":"2026-09-20T04:30:00Z",
           "canals":[],"in_progress":false,"surface":${surface?.let {
        "\"$it\""
    } ?: "null"}${if (elsewhere) ""","elsewhere":true""" else ""}}"""

    private fun chart(
        current: List<String>,
        statuses: String? = null,
        history: List<String> = emptyList(),
    ) = """{"current":${current.joinToString(",", "[", "]")},"history":${history.joinToString(",", "[", "]")},"terms":[]
           ${statuses?.let { ""","statuses":$it""" } ?: ""}}"""

    private val watch16 =
        """[{"tooth":16,"health":"watch","note":"Thin enamel","treat_within_months":6,"recorded_at":"2026-11-01T04:30:00Z"}]"""

    @Test
    fun the_doctors_status_comes_with_the_chart_and_findings_suggest_the_rest() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                route,
                { json(chart(listOf(entry("e1", 36, "caries", "O"), entry("e2", 46, "crown")), watch16)) },
            )
            val graph = testGraph(backend, backgroundScope)
            val chart = graph.chart(openClinic(backend, graph, this, readWrite), "p1", backgroundScope)
            val loaded = chart.state.first { it is ChartState.Loaded } as ChartState.Loaded
            assertEquals(
                ToothStatusView(HealthLevel.Watch, "Thin enamel", 6, loaded.statuses[16]?.at),
                loaded.statuses[16],
            )
            val tooth = { n: Int -> (loaded.upper + loaded.lower).first { it.number == n } }
            assertEquals(HealthLevel.NeedsTreatment, tooth(36).suggestedHealth)
            assertEquals(HealthLevel.Healthy, tooth(46).suggestedHealth)
            assertNull(tooth(11).suggestedHealth, "nothing recorded is not assessed")
            assertEquals(HealthMark.NeedsTreatment, loaded.healthMark(tooth(36)))
            assertEquals(HealthMark.Watch, loaded.healthMark(tooth(16)), "the doctor's status wins")
            assertEquals(HealthMark.NotAssessed, loaded.healthMark(tooth(11)))
            chart.select(16, null)
            val picked =
                (chart.state.first { (it as? ChartState.Loaded)?.selected != null } as ChartState.Loaded)
                    .selected
            assertEquals(HealthLevel.Watch, picked?.status?.level)
        }

    @Test
    fun setting_health_shows_at_once_sends_months_only_when_advised_and_a_refusal_puts_it_back() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(chart(listOf(entry("e1", 36, "caries", "O")))) })
            val status = "$route/teeth/36/status"
            backend.on(
                status,
                {
                    json(
                        """{"tooth":36,"health":"needs_treatment","treat_within_months":3,"recorded_at":"2026-11-18T04:30:00Z"}""",
                    )
                },
                { apiError(HttpStatusCode.Forbidden, "forbidden") },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, readWrite)
            val chart = graph.chart(clinic, "p1", backgroundScope)
            chart.state.first { it is ChartState.Loaded }
            val sheet = graph.toothSheet(clinic, chart, null, backgroundScope)
            sheet.setHealth(36, HealthLevel.NeedsTreatment, months = 3, note = "  ")
            sheet.health.first { !it.saving && it.error == null }
            val sent =
                (
                    backend.requests
                        .last {
                            it.url.encodedPath.endsWith(
                                "/teeth/36/status",
                            )
                        }.body as TextContent
                ).text
            assertTrue(""""health":"needs_treatment"""" in sent && """"treat_within_months":3""" in sent, sent)
            assertTrue(""""client_id":""" in sent && "note" !in sent, sent)
            assertEquals(3, chart.statusOf(36)?.treatWithinMonths)
            sheet.setHealth(36, HealthLevel.Healthy, months = 6)
            sheet.health.first { it.error != null }
            val refused =
                (
                    backend.requests
                        .last {
                            it.url.encodedPath.endsWith(
                                "/teeth/36/status",
                            )
                        }.body as TextContent
                ).text
            assertFalse("treat_within_months" in refused, "healthy takes no months: $refused")
            assertEquals(HealthLevel.NeedsTreatment, chart.statusOf(36)?.level, "the refusal put the last status back")
            assertEquals(ScreenError.NotAllowed, sheet.health.value.error)
        }

    @Test
    fun clearing_goes_back_to_what_the_findings_suggest() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(chart(listOf(entry("e1", 16, "filled", "O")), watch16)) })
            backend.on("$route/teeth/16/status", { respond("", HttpStatusCode.NoContent) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, readWrite)
            val chart = graph.chart(clinic, "p1", backgroundScope)
            chart.state.first { (it as? ChartState.Loaded)?.statuses?.isNotEmpty() == true }
            val sheet = graph.toothSheet(clinic, chart, null, backgroundScope)
            sheet.clearHealth(16)
            sheet.health.first { !it.saving }
            assertNull(chart.statusOf(16))
            assertEquals(HttpMethod.Delete, backend.requests.last().method)
            sheet.clearHealth(16)
            assertEquals(1, backend.requests.count { it.method == HttpMethod.Delete }, "nothing to clear twice")
        }

    @Test
    fun work_done_elsewhere_marks_the_chart_only_and_is_offered_for_finished_work() =
        runTest {
            val backend = FakeBackend()
            var posted = ""
            backend.on(route, { request ->
                if (request.method == HttpMethod.Post) {
                    posted = (request.body as TextContent).text
                    json(chart(listOf(entry("e9", 46, "crown", elsewhere = true))))
                } else {
                    json(chart(emptyList(), history = listOf(entry("e9", 46, "crown", elsewhere = true))))
                }
            })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, readWrite)
            val chart = graph.chart(clinic, "p1", backgroundScope)
            chart.state.first { it is ChartState.Loaded }
            chart.select(46, null)
            val sheet = graph.toothSheet(clinic, chart, "v1", backgroundScope)
            sheet.chooseTreatment(TermView("crown", TermKind.Procedure, "Crown", own = false))
            assertTrue(sheet.form.value.canElsewhere)
            sheet.setStatus(TreatmentStatus.Planned)
            assertFalse(sheet.form.value.canElsewhere, "a plan is not work done")
            sheet.setStatus(TreatmentStatus.Completed)
            sheet.setElsewhere(true)
            sheet.save(46)
            assertTrue(sheet.form.value.saved)
            chart.state.first { (it as? ChartState.Loaded)?.saving == false && posted.isNotEmpty() }
            assertTrue(""""elsewhere":true""" in posted && """"finding":"crown"""" in posted, posted)
            assertEquals(0, backend.requests.count { it.url.encodedPath.contains("/visits/") }, "no visit procedure")
            val history =
                chart.state.first {
                    ((it as? ChartState.Loaded)?.selected?.history as? HistoryState.Loaded) !=
                        null
                }
            val rows = ((history as ChartState.Loaded).selected?.history as HistoryState.Loaded).entries
            assertTrue(rows.single().elsewhere)
        }
}
