package com.aarogyam.staff.analytics

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AnalyticsStateHolderTest {
    private val today = LocalDate(2026, 10, 9) // a Friday

    private fun bucket(
        start: String,
        new: Int,
        returning: Int,
        income: Long,
        expenses: Long,
        booked: Int,
        open: Int,
        appts: Int,
    ) = """{"start":"$start","first_day":"$start","last_day":"$start","patients":{"new":$new,"returning":$returning},
           "income_paise":$income,"expenses_paise":$expenses,"payments":3,"stock_purchases_paise":0,
           "expenses":[{"category":"lab","amount_paise":$expenses},{"category":"rent","amount_paise":0}],
           "chair_utilization":[{"room_id":"r1","booked_minutes":$booked,"open_minutes":$open,"appointments":$appts,"utilization_bps":0}]}"""

    private fun body(
        money: Boolean = true,
        vararg buckets: String,
    ) = """{"from":"2026-08-01","to":"2026-10-09","bucket":"month","open_minutes_per_day":540,"money_visible":$money,
           "chairs":[{"id":"r1","name":"Chair 1","uses_clinic_hours":true}],"buckets":[${buckets.joinToString(",")}],
           "busy_hours":[{"weekday":1,"hour":10,"visits":4}],"lab_turnaround":{"orders_received":0,"average_days":null},
           "patients":{"age_bands":[{"key":"18_34","count":9}],"visit_kinds":[{"key":"new","count":3},{"key":"procedure","count":5}],
           "referral_sources":[]}}"""

    @Test
    fun ranges_cover_the_bars_and_the_window_before() {
        assertEquals("week" to LocalDate(2026, 7, 13), AnalyticsStateHolder.rangeOf(AnalyticsPeriod.Week, today))
        assertEquals("month" to LocalDate(2025, 10, 1), AnalyticsStateHolder.rangeOf(AnalyticsPeriod.Month, today))
        assertEquals("month" to LocalDate(2024, 11, 1), AnalyticsStateHolder.rangeOf(AnalyticsPeriod.Year, today))
    }

    @Test
    fun numbers_compare_this_month_with_last_month() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/reports/analytics",
                {
                    json(
                        body(
                            true,
                            bucket("2026-09-01", 10, 30, 400000, 50000, 600, 1200, 20),
                            bucket("2026-10-01", 12, 33, 500000, 80000, 900, 1500, 30),
                        ),
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("analytics.view", "finance.view"))
            val holder = AnalyticsStateHolder(clinic, this, today = { today })
            holder.show(AnalyticsPeriod.Month)
            val month = holder.state.first { it is AnalyticsState.Loaded && it.view.period == AnalyticsPeriod.Month }
            val view = (month as AnalyticsState.Loaded).view
            assertEquals(Kpi(45, 40, 12), view.patientVisits)
            assertEquals(Kpi(12, 10, 20), view.newPatients)
            assertEquals(Kpi(500000, 400000, 25), view.revenue)
            assertEquals(Kpi(80000, 50000, 60), view.expenses)
            assertEquals(listOf(Share("lab", 80000), Share("rent", 0)), view.expensesByCategory)
            assertEquals(30, view.avgChairMinutes)
            assertEquals(0.6f, view.chairUtilization)
            assertEquals(listOf(BusyCell(1, 10, 4)), view.busyHours)
            assertEquals(listOf(Share("new", 3), Share("procedure", 5)), view.visitKinds)
            assertEquals(2, view.bars.size)
            assertEquals(45, view.bars.last().patientVisits)
            val q =
                backend.requests
                    .last()
                    .url.parameters
            assertEquals("month", q["bucket"])
            assertEquals("2025-10-01", q["from"])
            assertEquals("2026-10-09", q["to"])
        }

    @Test
    fun money_stays_hidden_without_finance_view_and_a_zero_base_has_no_delta() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/reports/analytics",
                {
                    json(
                        body(
                            false,
                            bucket("2026-09-01", 0, 0, 0, 0, 0, 0, 0),
                            bucket("2026-10-01", 2, 1, 0, 0, 0, 0, 0),
                        ),
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("analytics.view"))
            val holder = AnalyticsStateHolder(clinic, this, today = { today })
            val view = (holder.state.first { it is AnalyticsState.Loaded } as AnalyticsState.Loaded).view
            assertNull(view.revenue)
            assertNull(view.bars.last().incomePaise)
            assertNull(view.patientVisits.deltaPercent)
            assertNull(view.avgChairMinutes)
        }

    @Test
    fun a_period_seen_once_is_not_requested_again_until_refresh() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/reports/analytics",
                { json(body(true, bucket("2026-10-01", 1, 1, 0, 0, 0, 0, 0))) },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("analytics.view"))
            val holder = AnalyticsStateHolder(clinic, this, today = { today })
            holder.state.first { it is AnalyticsState.Loaded }
            holder.show(AnalyticsPeriod.Year)
            holder.state.first { it is AnalyticsState.Loaded && it.view.period == AnalyticsPeriod.Year }
            holder.show(AnalyticsPeriod.Week)
            assertEquals(2, backend.count("$SUNRISE/api/v1/reports/analytics"))
            holder.refresh()
            holder.state.first {
                it is AnalyticsState.Loaded && backend.count(
                    "$SUNRISE/api/v1/reports/analytics",
                ) == 3
            }
        }

    @Test
    fun without_analytics_view_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view"))
            assertEquals(AnalyticsState.NotAllowed, AnalyticsStateHolder(clinic, this, today = { today }).state.value)
            assertEquals(0, backend.count("$SUNRISE/api/v1/reports/analytics"))
        }
}
