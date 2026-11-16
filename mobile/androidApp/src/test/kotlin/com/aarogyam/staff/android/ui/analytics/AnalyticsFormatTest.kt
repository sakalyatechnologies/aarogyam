package com.aarogyam.staff.android.ui.analytics

import com.aarogyam.staff.analytics.AnalyticsBucketKind
import com.aarogyam.staff.analytics.HeatCell
import com.aarogyam.staff.expenses.SpendCategory
import kotlinx.datetime.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class AnalyticsFormatTest {
    @Test
    fun rupeesCompactAndSigned() {
        assertEquals("₹800", AnalyticsFormat.rupees(80_000))
        assertEquals("₹45k", AnalyticsFormat.rupees(4_500_000))
        assertEquals("₹1.2L", AnalyticsFormat.rupees(12_000_000))
        assertEquals("−₹1.5k", AnalyticsFormat.rupees(-150_000))
    }

    @Test
    fun deltaTextAndTone() {
        assertNull(AnalyticsFormat.delta(null))
        assertEquals("+12%", AnalyticsFormat.delta(12))
        assertEquals("−8%", AnalyticsFormat.delta(-8))
        assertTrue(AnalyticsFormat.isBad(-3, goodWhenDown = false))
        assertFalse(AnalyticsFormat.isBad(-3, goodWhenDown = true))
        assertTrue(AnalyticsFormat.isBad(5, goodWhenDown = true))
        assertFalse(AnalyticsFormat.isBad(null, goodWhenDown = true))
    }

    @Test
    fun keysRead() {
        assertEquals("Root canal", AnalyticsFormat.keyText("root_canal"))
        assertEquals("18–34", AnalyticsFormat.ageBand("18_34"))
        assertEquals("65+", AnalyticsFormat.ageBand("65_plus"))
        assertEquals(SpendCategory.Electricity, AnalyticsFormat.category("Utilities"))
        assertEquals(SpendCategory.Other, AnalyticsFormat.category("stationery"))
    }

    @Test
    fun sharesAndPercent() {
        assertEquals(listOf(1f, 0.5f, 0f), AnalyticsFormat.shares(listOf(10, 5, 0)))
        assertEquals(listOf(0f), AnalyticsFormat.shares(listOf(0)))
        assertEquals(33, AnalyticsFormat.percentOf(1, 3))
        assertEquals(0, AnalyticsFormat.percentOf(1, 0))
    }

    @Test
    fun radarNeedsThreeKinds() {
        assertNull(AnalyticsFormat.radar(listOf("a" to 5L, "b" to 3L, "c" to 0L)))
        val top = AnalyticsFormat.radar((1..8).map { "k$it" to it.toLong() })
        assertEquals(6, top?.size)
        assertEquals("k8", top?.first()?.first)
    }

    @Test
    fun heatGridCoversWorkingHours() {
        val grid = AnalyticsFormat.heat(listOf(HeatCell(1, 10, 30), HeatCell(7, 19, 60), HeatCell(9, 10, 5)))
        assertEquals((9..19).toList(), grid.hours)
        assertEquals(0.5f, grid.loads[0][1], 0.001f)
        assertEquals(1f, grid.loads[6][10], 0.001f)
        assertEquals(30, grid.values[0][1])
        assertEquals(9..17, AnalyticsFormat.heat(emptyList()).hours.let { it.first()..it.last() })
    }

    @Test
    fun scaleCoversNegativesAndZero() {
        val s = AnalyticsFormat.scale(-30.0, 90.0)
        assertTrue(s.min <= -30.0 && s.max >= 90.0)
        assertTrue(s.ticks.contains(0.0))
        val flat = AnalyticsFormat.scale(0.0, 0.0)
        assertTrue(flat.max > flat.min)
    }

    @Test
    fun nearestPicksClosestPoint() {
        assertEquals(0, AnalyticsFormat.nearest(0.1f, 1))
        assertEquals(2, AnalyticsFormat.nearest(0.5f, 5))
        assertEquals(4, AnalyticsFormat.nearest(2f, 5))
    }

    @Test
    fun datesAndLabels() {
        val day = LocalDate(2026, 8, 17)
        assertEquals(day, AnalyticsFormat.day(AnalyticsFormat.millis(day)))
        assertEquals("17 Aug", AnalyticsFormat.bucketLabel(day, AnalyticsBucketKind.Week, Locale.UK))
        assertEquals("Aug 2026", AnalyticsFormat.bucketLabel(day, AnalyticsBucketKind.Month, Locale.UK))
        assertEquals("Aug 26", AnalyticsFormat.axisLabel(day, AnalyticsBucketKind.Month, true, Locale.UK))
        assertEquals("17 Aug" to "15 Nov 2026", AnalyticsFormat.rangeEnds(day, LocalDate(2026, 11, 15), Locale.UK))
        assertEquals(
            "17 Aug 2025" to "15 Nov 2026",
            AnalyticsFormat.rangeEnds(LocalDate(2025, 8, 17), LocalDate(2026, 11, 15), Locale.UK),
        )
        assertEquals(2, AnalyticsFormat.spanDays(day, LocalDate(2026, 8, 18)))
        assertEquals("Mon", AnalyticsFormat.weekdays(Locale.UK).first())
    }
}
