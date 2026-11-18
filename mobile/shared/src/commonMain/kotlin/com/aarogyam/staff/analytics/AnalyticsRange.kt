package com.aarogyam.staff.analytics

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.daysUntil
import kotlinx.datetime.minus

/** The Analytics range switch: three presets ending today, or a custom pair of dates. */
enum class AnalyticsPreset {
    /** The last 7 days, one bar a day. */
    Week,

    /** The last 6 months, from the 1st. */
    Month,

    /** The last 12 months, from the 1st. */
    Year,

    /** Two dates the user picked, at most [AnalyticsRange.MAX_DAYS] apart. */
    Custom,
}

/**
 * How the server groups the days: daily up to [AnalyticsRange.DAILY_MAX_DAYS] days, weekly up to
 * [AnalyticsRange.WEEKLY_MAX_DAYS], monthly beyond.
 */
enum class AnalyticsBucketKind(
    val wire: String,
) {
    Day("day"),
    Week("week"),
    Month("month"),
}

/** The days Analytics covers, both ends included. */
data class AnalyticsRange(
    val preset: AnalyticsPreset,
    val from: LocalDate,
    val to: LocalDate,
) {
    val days: Int get() = from.daysUntil(to) + 1

    val bucket: AnalyticsBucketKind
        get() =
            when {
                days <= DAILY_MAX_DAYS -> AnalyticsBucketKind.Day
                days <= WEEKLY_MAX_DAYS -> AnalyticsBucketKind.Week
                else -> AnalyticsBucketKind.Month
            }

    /** The range of the same length right before this one, the base for every delta. */
    fun previous(): AnalyticsRange =
        AnalyticsRange(
            AnalyticsPreset.Custom,
            from.minus(DatePeriod(days = days)),
            from.minus(DatePeriod(days = 1)),
        )

    companion object {
        /** The API's longest range. */
        const val MAX_DAYS = 731

        /** Up to this many days the buckets are days (the API allows 92; a month of bars still reads). */
        const val DAILY_MAX_DAYS = 31

        /** Beyond this many days the buckets are months. */
        const val WEEKLY_MAX_DAYS = 120

        private const val DAYS_PER_WEEK = 7
        private const val HALF_YEAR = 6
        private const val YEAR = 12

        fun of(
            preset: AnalyticsPreset,
            today: LocalDate,
        ): AnalyticsRange {
            val monthStart = LocalDate(today.year, today.month, 1)
            val from =
                when (preset) {
                    AnalyticsPreset.Week -> {
                        today.minus(DatePeriod(days = DAYS_PER_WEEK - 1))
                    }

                    AnalyticsPreset.Month -> {
                        monthStart.minus(DatePeriod(months = HALF_YEAR - 1))
                    }

                    AnalyticsPreset.Year, AnalyticsPreset.Custom -> {
                        monthStart.minus(DatePeriod(months = YEAR - 1))
                    }
                }
            return AnalyticsRange(preset, from, today)
        }

        /** A picked pair made valid: ends swapped when reversed, [to] not after [today], at most [MAX_DAYS] long. */
        fun custom(
            first: LocalDate,
            second: LocalDate,
            today: LocalDate,
        ): AnalyticsRange {
            val to = minOf(maxOf(first, second), today)
            var from = minOf(minOf(first, second), to)
            if (from.daysUntil(to) + 1 > MAX_DAYS) from = to.minus(DatePeriod(days = MAX_DAYS - 1))
            return AnalyticsRange(AnalyticsPreset.Custom, from, to)
        }
    }
}
