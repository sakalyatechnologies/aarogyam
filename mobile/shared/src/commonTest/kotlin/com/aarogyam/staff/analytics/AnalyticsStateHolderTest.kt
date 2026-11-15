package com.aarogyam.staff.analytics

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AnalyticsStateHolderTest {
    private val today = LocalDate(2026, 10, 9)
    private val route = "$SUNRISE/api/v1/reports/analytics"
    private val sept1 = LocalDate(2026, 9, 1)

    private fun FakeBackend.serve(
        current: String,
        before: String,
    ) = on(route, { json(if (it.url.parameters["from"] == "2026-09-01") current else before) })

    private val thisRange =
        analyticsBody(
            true,
            analyticsBucket("2026-08-31", 10, 30, 400000, 50000, 600, 1200, 20, chair2Booked = 300),
            analyticsBucket("2026-09-07", 12, 33, 500000, 80000, 900, 1500, 30),
        )
    private val lastRange =
        analyticsBody(true, analyticsBucket("2026-07-27", 8, 22, 300000, 40000, 100, 1000, 5))

    private suspend fun kotlinx.coroutines.test.TestScope.holder(
        backend: FakeBackend,
        vararg permissions: String,
    ): AnalyticsStateHolder {
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, permissions.toList())
        return AnalyticsStateHolder(clinic, this, today = { today })
    }

    private suspend fun AnalyticsStateHolder.loaded(
        deltas: Boolean = true,
        from: LocalDate? = null,
    ): AnalyticsView =
        (
            state.first {
                it is AnalyticsState.Loaded && (from == null || it.view.range.from == from) &&
                    (!deltas || it.view.patientVisits.previous != null)
            } as AnalyticsState.Loaded
        ).view

    @Test
    fun numbers_cover_the_range_and_compare_with_the_range_before() =
        runTest {
            val backend = FakeBackend().also { it.serve(thisRange, lastRange) }
            val holder = holder(backend, "analytics.view", "finance.view")
            holder.showCustom(sept1, today)
            val view = holder.loaded(from = sept1)
            assertEquals(AnalyticsBucketKind.Week, view.bucket)
            assertEquals(Kpi(85, 30, 183), view.patientVisits)
            assertEquals(Kpi(22, 8, 175), view.newPatients)
            assertEquals(Kpi(900000, 300000, 200), view.revenue)
            assertEquals(Kpi(130000, 40000, 225), view.expenses)
            assertEquals(770000, view.netPaise)
            assertEquals(6, view.payments)
            assertEquals(listOf(Share("lab", 130000)), view.expensesByCategory)
            assertEquals(770000, view.points.sumOf { it.netPaise ?: 0 })
            assertEquals(2, view.points.size)
            assertEquals(45, view.points.last().patientVisits)
            assertEquals(false, view.isEmpty)
            val q = backend.requests.map { it.url.parameters }
            assertEquals(listOf("week", "week"), q.takeLast(2).map { it["bucket"] })
            assertEquals(listOf("2026-09-01", "2026-07-24"), q.takeLast(2).map { it["from"] })
            assertEquals(listOf("2026-10-09", "2026-08-31"), q.takeLast(2).map { it["to"] })
        }

    @Test
    fun chairs_get_their_own_percent_and_the_split_gets_shares() =
        runTest {
            val backend = FakeBackend().also { it.serve(thisRange, lastRange) }
            val holder = holder(backend, "analytics.view", "finance.view")
            holder.showCustom(sept1, today)
            val view = holder.loaded(deltas = false, from = sept1)
            assertEquals(listOf("Chair 1", "Chair 2"), view.chairs.map { it.name })
            assertEquals(listOf(56, 11), view.chairs.map { it.percent }) // 1500/2700, 300/2700
            assertEquals(50, view.chairs.sumOf { it.appointments }.toInt())
            assertEquals(36, view.avgChairMinutes)
            assertEquals(listOf(60, 20, 20), view.chairTime.map { it.percent })
            assertEquals(listOf("treatment", "consult", "admin"), view.chairTime.map { it.key })
            assertEquals(VisitSplit(30, 10, 75), view.visitSources)
            assertEquals(LabStats(4, 2.5), view.lab)
            assertEquals(listOf(Share("male", 8), Share("female", 6)), view.sex)
            assertEquals(listOf(HeatCell(2, 11, 90)), view.heat)
            assertEquals(HeatUnit.BookedMinutes, view.heatUnit)
        }

    @Test
    fun procedure_categories_sort_by_count_and_carry_amounts_only_with_money() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(thisRange) })
            val rich = holder(backend, "analytics.view", "finance.view").loaded(deltas = false)
            assertEquals(
                listOf(ProcedureShare("root_canal", 7, 70000), ProcedureShare("filling", 2, 5000)),
                rich.procedures,
            )
            val none = FakeBackend()
            none.on(route, { json(analyticsBody(false, analyticsBucket("2026-09-07", 2, 1, 0, 0, 0, 0, 0))) })
            val poor = holder(none, "analytics.view").loaded(deltas = false)
            assertEquals(listOf(null, null), poor.procedures.map { it.amountPaise })
            assertNull(poor.revenue)
            assertNull(poor.netPaise)
            assertNull(poor.payments)
            assertNull(poor.points.last().incomePaise)
            assertNull(poor.patientVisits.deltaPercent)
        }

    @Test
    fun an_empty_range_is_flagged_and_without_occupancy_the_heat_falls_back_to_visits() =
        runTest {
            val backend = FakeBackend()
            val empty =
                analyticsBody(true, analyticsBucket("2026-09-07", 0, 0, 0, 0, 0, 0, 0), heat = "[]")
                    .replace(
                        """"visit_kinds":[{"key":"new","count":3},{"key":"procedure","count":5}]""",
                        """"visit_kinds":[]""",
                    )
            backend.on(route, { json(empty) })
            val view = holder(backend, "analytics.view", "finance.view").loaded(deltas = false)
            assertTrue(view.isEmpty)
            assertEquals(HeatUnit.Visits, view.heatUnit)
            assertEquals(listOf(HeatCell(1, 10, 4)), view.heat)
        }

    @Test
    fun a_failed_previous_range_leaves_the_page_without_deltas() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, {
                if (it.url.parameters["from"] ==
                    "2026-09-01"
                ) {
                    json(thisRange)
                } else {
                    apiError(HttpStatusCode.InternalServerError, "boom")
                }
            })
            val holder = holder(backend, "analytics.view", "finance.view")
            holder.showCustom(sept1, today)
            val view = holder.loaded(deltas = false, from = sept1)
            assertNull(view.patientVisits.deltaPercent)
            assertEquals(85, view.patientVisits.value)
        }

    @Test
    fun a_range_seen_once_is_not_requested_again_until_refresh() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(thisRange) })
            val holder = holder(backend, "analytics.view")
            holder.loaded()
            assertEquals(2, backend.count(route))
            holder.show(AnalyticsPreset.Year)
            holder.state.first {
                it is AnalyticsState.Loaded && it.view.range.preset == AnalyticsPreset.Year &&
                    it.view.patientVisits.previous != null
            }
            holder.show(AnalyticsPreset.Week)
            assertEquals(AnalyticsPreset.Week, (holder.state.value as AnalyticsState.Loaded).view.range.preset)
            assertEquals(4, backend.count(route))
            holder.refresh()
            holder.state.first {
                it is AnalyticsState.Loaded && it.view.patientVisits.previous != null &&
                    backend.count(route) == 6
            }
        }

    @Test
    fun an_error_answer_becomes_a_failed_state() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.InternalServerError, "boom") })
            val holder = holder(backend, "analytics.view")
            assertTrue(holder.state.first { it is AnalyticsState.Failed } is AnalyticsState.Failed)
        }

    @Test
    fun without_analytics_view_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, "finance.view")
            assertEquals(AnalyticsState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count(route))
        }
}
