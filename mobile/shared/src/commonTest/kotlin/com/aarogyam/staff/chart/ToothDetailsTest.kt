package com.aarogyam.staff.chart

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.TimeZone
import kotlinx.datetime.todayIn
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock

class ToothDetailsTest {
    private val route = "$SUNRISE/api/v1/patients/p1/dental-chart"
    private val readWrite = listOf("patients.read", "clinical.read", "clinical.write")

    private fun entry(
        id: String,
        tooth: Int,
        finding: String,
        surface: String? = null,
        at: String = "2026-09-20T04:30:00Z",
        extra: String = "",
    ) = """{"id":"$id","tooth":$tooth,"finding":"$finding","status":"current","effective_at":"$at","canals":[],
           "in_progress":false,"surface":${surface?.let { "\"$it\"" } ?: "null"}$extra}"""

    private fun chart(
        current: List<String>,
        conditions: String? = null,
        eruptions: String? = null,
        history: List<String> = emptyList(),
    ) = """{"current":${current.joinToString(",", "[", "]")},"history":${history.joinToString(",", "[", "]")},"terms":[]
           ${conditions?.let { ""","conditions":$it""" } ?: ""}${eruptions?.let { ""","eruptions":$it""" } ?: ""}}"""

    private fun condition(
        tooth: Int,
        fields: String,
    ) = """{"id":"c$tooth","tooth":$tooth,$fields,"recorded_at":"2026-11-12T04:30:00Z"}"""

    private suspend fun TestScope.open(backend: FakeBackend): Pair<ChartStateHolder, ToothSheetStateHolder> {
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, readWrite)
        val chart = graph.chart(clinic, "p1", backgroundScope)
        chart.state.first { it is ChartState.Loaded }
        return chart to graph.toothSheet(clinic, chart, null, backgroundScope)
    }

    private suspend fun ChartStateHolder.details(tooth: Int): ToothDetailsView {
        select(tooth, null)
        val loaded =
            state.first {
                val s = (it as? ChartState.Loaded)?.selected
                s?.tooth?.number == tooth && s.history is HistoryState.Loaded
            } as ChartState.Loaded
        return checkNotNull(loaded.selected).details
    }

    private fun FakeBackend.sent(suffix: String): List<String> =
        requests.filter { it.url.encodedPath.endsWith(suffix) }.map { (it.body as TextContent).text }

    @Test
    fun the_chart_brings_each_teeths_details_and_unknown_values_are_ignored() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                route,
                {
                    json(
                        chart(
                            listOf(
                                entry("e1", 36, "caries", "O", extra = ""","caries_depth":"dentin""""),
                                entry("e2", 36, "caries", "M", extra = ""","caries_depth":"near_pulp""""),
                                entry("e3", 46, "missing"),
                            ),
                            conditions =
                                "[" + condition(36, """"infection":"abscess","pocket_mm":9,"mobility":2""") + "," +
                                    condition(46, """"infection":"infection"""") + "," +
                                    condition(11, """"infection":"cyst"""") + "]",
                            eruptions =
                                """[{"id":"r1","tooth":38,"eruption":"impacted","angulation":"mesioangular",
                                   "recorded_at":"2026-11-12T04:30:00Z"},
                                   {"id":"r2","tooth":48,"eruption":"sideways","recorded_at":"2026-11-12T04:30:00Z"},
                                   {"id":"r3","tooth":13,"eruption":"impacted","recorded_at":"2026-11-12T04:30:00Z"}]""",
                        ),
                    )
                },
            )
            val (chart, _) = open(backend)
            val d36 = chart.details(36)
            assertTrue(d36.hasCaries)
            assertEquals(CariesDepth.NearPulp, d36.cariesDepth, "the deepest mark")
            assertEquals(RootInfection.Abscess, d36.condition?.infection)
            assertEquals(9, d36.condition?.pocketMm)
            assertEquals(2, d36.condition?.mobility)
            assertFalse(d36.missing || d36.wisdom || d36.positionOpen)
            assertTrue(d36.permanent, "a permanent tooth takes a position behind More")
            assertTrue(chart.details(46).missing)
            val d38 = chart.details(38)
            assertTrue(d38.wisdom && d38.positionOpen)
            assertEquals(ToothEruptionView(Eruption.Impacted, Angulation.Mesioangular, d38.eruption?.at), d38.eruption)
            assertNull(chart.details(48).eruption, "an eruption value from a later server is left out")
            val d11 = chart.details(11)
            assertNull(d11.condition?.infection)
            assertFalse(d11.hasCaries)
            assertTrue(chart.details(13).positionOpen, "a recorded position shows without More")
            assertFalse(chart.details(55).permanent, "a milk tooth never takes a position")
        }

    @Test
    fun a_condition_tap_merges_one_field_and_untapping_the_last_leaves_none() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(chart(listOf(entry("e1", 36, "caries", "O")))) })
            backend.on(
                "$route/teeth/36/condition",
                { json(condition(36, """"infection":"abscess"""")) },
                { json(condition(36, """"infection":"abscess","bleeding":true""")) },
                { json(condition(36, """"bleeding":true""")) },
                { json("""{"id":"c36b","tooth":36,"recorded_at":"2026-11-21T04:30:00Z"}""") },
            )
            val (chart, sheet) = open(backend)
            sheet.setInfection(36, RootInfection.Abscess)
            sheet.detail.first { !it.saving }
            sheet.setBleeding(36, true)
            sheet.detail.first { !it.saving }
            sheet.setInfection(36, null)
            sheet.detail.first { !it.saving }
            assertEquals(
                listOf("""{"infection":"abscess"}""", """{"bleeding":true}""", """{"infection":null}"""),
                backend.sent("/teeth/36/condition"),
            )
            assertEquals(ToothConditionView(bleeding = true, at = chart.conditionOf(36)?.at), chart.conditionOf(36))
            sheet.setBleeding(36, false)
            sheet.detail.first { !it.saving }
            assertEquals("""{"bleeding":null}""", backend.sent("/teeth/36/condition").last())
            assertNull(chart.conditionOf(36), "an empty answer leaves the tooth with no condition")
        }

    @Test
    fun a_refused_detail_is_put_back_and_said() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(chart(emptyList(), conditions = "[" + condition(21, """"mobility":1""") + "]")) })
            backend.on("$route/teeth/21/condition", { apiError(HttpStatusCode.Conflict, "missing_tooth") })
            val (chart, sheet) = open(backend)
            chart.details(21)
            sheet.setMobility(21, 3)
            sheet.detail.first { it.error != null }
            assertEquals(1, chart.conditionOf(21)?.mobility)
            assertEquals(ScreenError.Unknown, sheet.detail.value.error)
        }

    @Test
    fun a_wisdom_tooth_takes_its_position_then_an_angle() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(chart(emptyList())) })
            backend.on(
                "$route/teeth/38/eruption",
                { json("""{"id":"r1","tooth":38,"eruption":"partial","recorded_at":"2026-11-20T04:30:00Z"}""") },
                {
                    json(
                        """{"id":"r2","tooth":38,"eruption":"partial","angulation":"distoangular","recorded_at":"2026-11-20T04:30:00Z"}""",
                    )
                },
            )
            val (chart, sheet) = open(backend)
            sheet.setAngulation(38, Angulation.Vertical)
            sheet.setEruption(38, Eruption.Partial)
            sheet.detail.first { !it.saving }
            sheet.setEruption(38, Eruption.Partial)
            sheet.setAngulation(38, Angulation.Distoangular)
            sheet.detail.first { !it.saving }
            assertEquals(
                listOf("""{"eruption":"partial"}""", """{"eruption":"partial","angulation":"distoangular"}"""),
                backend.sent("/teeth/38/eruption"),
                "no angle before a position, and the same position again asks nothing",
            )
            assertEquals(Angulation.Distoangular, chart.eruptionOf(38)?.angulation)
        }

    @Test
    fun a_decay_depth_resaves_every_decay_mark_with_its_note() =
        runTest {
            val backend = FakeBackend()
            val start =
                chart(
                    listOf(
                        entry("e1", 36, "caries", "O", extra = ""","note":"stain""""),
                        entry("e2", 36, "caries", "M"),
                        entry("e3", 36, "filled", "D"),
                    ),
                )
            val after =
                chart(
                    listOf(
                        entry("e4", 36, "caries", "O", extra = ""","caries_depth":"dentin","note":"stain""""),
                        entry("e5", 36, "caries", "M", extra = ""","caries_depth":"dentin""""),
                        entry("e3", 36, "filled", "D"),
                    ),
                )
            backend.on(route, { json(start) }, { json(start) }, { json(after) }, { json(after) })
            val (chart, sheet) = open(backend)
            chart.details(36)
            sheet.setCariesDepth(36, CariesDepth.Dentin)
            chart.state.first {
                (it as? ChartState.Loaded)?.saving == false && it.selected?.details?.cariesDepth != null
            }
            val body =
                backend.requests
                    .last { it.method == HttpMethod.Post && it.url.encodedPath == "/api/v1/patients/p1/dental-chart" }
                    .let { (it.body as TextContent).text }
            assertEquals(2, Regex("\"caries_depth\":\"dentin\"").findAll(body).count(), body)
            assertTrue("\"note\":\"stain\"" in body && "\"filled\"" !in body, body)
            assertEquals(CariesDepth.Dentin, chart.details(36).cariesDepth)
        }

    @Test
    fun infection_resolved_is_offered_after_work_charted_today() =
        runTest {
            val today =
                Clock.System
                    .todayIn(TimeZone.of("Asia/Kolkata"))
                    .toString()
            val work = entry("e1", 36, "root_canal", at = "${today}T06:30:00Z")
            val backend = FakeBackend()
            backend.on(
                route,
                {
                    json(
                        chart(
                            listOf(work, entry("e2", 26, "root_canal", at = "${today}T06:30:00Z")),
                            conditions =
                                "[" + condition(36, """"infection":"infection","mobility":1""") + "," +
                                    condition(26, """"infection":"infection"""") + "]",
                            history = listOf(work),
                        ),
                    )
                },
            )
            val (chart, _) = open(backend)
            assertTrue(chart.details(36).canResolveInfection)
            assertTrue(chart.details(26).canResolveInfection, "an infection alone can be resolved too")
            assertFalse(chart.details(11).canResolveInfection, "no infection, nothing to resolve")
        }
}
