package com.aarogyam.staff.analytics

import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals

class AnalyticsRangeTest {
    private val today = LocalDate(2026, 10, 9) // a Friday

    @Test
    fun presets_end_today_and_start_on_a_bucket_boundary() {
        assertEquals(
            AnalyticsRange(AnalyticsPreset.Week, LocalDate(2026, 8, 17), today),
            AnalyticsRange.of(AnalyticsPreset.Week, today),
        )
        assertEquals(LocalDate(2026, 5, 1), AnalyticsRange.of(AnalyticsPreset.Month, today).from)
        assertEquals(LocalDate(2025, 11, 1), AnalyticsRange.of(AnalyticsPreset.Year, today).from)
    }

    @Test
    fun the_bucket_is_weekly_up_to_120_days_and_monthly_beyond() {
        val weekly = AnalyticsRange(AnalyticsPreset.Custom, LocalDate(2026, 6, 12), today) // 120 days
        assertEquals(120, weekly.days)
        assertEquals(AnalyticsBucketKind.Week, weekly.bucket)
        assertEquals(AnalyticsBucketKind.Month, weekly.copy(from = LocalDate(2026, 6, 11)).bucket)
        assertEquals(AnalyticsBucketKind.Week, AnalyticsRange.of(AnalyticsPreset.Week, today).bucket)
        assertEquals(AnalyticsBucketKind.Month, AnalyticsRange.of(AnalyticsPreset.Month, today).bucket)
        assertEquals(AnalyticsBucketKind.Month, AnalyticsRange.of(AnalyticsPreset.Year, today).bucket)
    }

    @Test
    fun the_previous_range_has_the_same_length_and_ends_the_day_before() {
        val range = AnalyticsRange(AnalyticsPreset.Custom, LocalDate(2026, 9, 1), LocalDate(2026, 9, 30))
        val before = range.previous()
        assertEquals(LocalDate(2026, 8, 2), before.from)
        assertEquals(LocalDate(2026, 8, 31), before.to)
        assertEquals(range.days, before.days)
    }

    @Test
    fun a_custom_pair_is_ordered_trimmed_to_today_and_capped_at_731_days() {
        val swapped = AnalyticsRange.custom(LocalDate(2026, 10, 1), LocalDate(2026, 9, 1), today)
        assertEquals(LocalDate(2026, 9, 1) to LocalDate(2026, 10, 1), swapped.from to swapped.to)
        assertEquals(today, AnalyticsRange.custom(LocalDate(2026, 10, 1), LocalDate(2027, 1, 1), today).to)
        val long = AnalyticsRange.custom(LocalDate(2020, 1, 1), today, today)
        assertEquals(AnalyticsRange.MAX_DAYS, long.days)
        assertEquals(today, long.to)
    }
}
