package com.aarogyam.staff.android.ui.analytics

import com.aarogyam.staff.analytics.AnalyticsBucketKind
import com.aarogyam.staff.analytics.HeatCell
import com.aarogyam.staff.expenses.SpendCategory
import kotlinx.datetime.LocalDate
import kotlinx.datetime.toJavaLocalDate
import kotlinx.datetime.toKotlinLocalDate
import java.time.DayOfWeek
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/** Pure text and layout maths for the Analytics cards (JVM-tested in `AnalyticsFormatTest`). The shared holder does the totals. */
object AnalyticsFormat {
    private const val LAKH = 1e5
    private const val THOUSAND = 1e3
    private const val PAISE = 100.0
    private const val MIN_RADAR = 3
    private const val MAX_RADAR = 6
    private const val MILLIS_PER_DAY = 86_400_000L
    private const val DAYS_IN_WEEK = 7
    private const val BAND_UNIT = 10.0
    private const val NICE_TWO = 2.0
    private const val NICE_FIVE = 5.0
    private const val FIRST_HOUR = 9
    private const val LAST_HOUR = 17

    /** `₹1.2L`, `₹45k`, `₹800` from paise; a minus sign for a loss. */
    fun rupees(paise: Long): String = if (paise < 0) "−" + compact(-paise) else compact(paise)

    private fun compact(paise: Long): String {
        val rupees = paise / PAISE
        return when {
            rupees >= LAKH -> "₹" + trimmed(rupees / LAKH) + "L"
            rupees >= THOUSAND -> "₹" + trimmed(rupees / THOUSAND) + "k"
            else -> "₹" + rupees.roundToInt()
        }
    }

    private fun trimmed(value: Double): String = String.format(Locale.US, "%.1f", value).removeSuffix(".0")

    /** `+12%` or `−8%`; null for no delta. */
    fun delta(percent: Int?): String? =
        when {
            percent == null -> null
            percent < 0 -> "−${-percent}%"
            else -> "+$percent%"
        }

    /** A delta is bad when it falls, except for [goodWhenDown] figures such as expenses. */
    fun isBad(
        percent: Int?,
        goodWhenDown: Boolean,
    ): Boolean = if (goodWhenDown) (percent ?: 0) > 0 else (percent ?: 0) < 0

    /** `root_canal` as `Root canal`. */
    fun keyText(key: String): String {
        val text = key.replace('_', ' ').replace('-', ' ')
        return text.replaceFirstChar { it.uppercase() }
    }

    /** `18_34` as `18–34`, `65_plus` as `65+`. */
    fun ageBand(key: String): String = if (key.endsWith("_plus")) key.replace("_plus", "+") else key.replace('_', '–')

    /** An expense category key as people read it (the server's key or the app's enum name). */
    fun category(key: String): SpendCategory =
        when (key.lowercase()) {
            "salary", "salaries" -> SpendCategory.Salary
            "material", "materials" -> SpendCategory.Material
            "electricity", "utilities" -> SpendCategory.Electricity
            "lab" -> SpendCategory.Lab
            "rent" -> SpendCategory.Rent
            else -> SpendCategory.Other
        }

    /** Each bar's width as a share of the biggest. */
    fun shares(values: List<Long>): List<Float> {
        val peak = max(values.maxOrNull() ?: 1L, 1L).toFloat()
        return values.map { it / peak }
    }

    /** A whole percent of [part] in [whole]; 0 when there is no whole. */
    fun percentOf(
        part: Long,
        whole: Long,
    ): Int = if (whole <= 0) 0 else (part * 100 / whole).toInt()

    /** The radar's axes: the biggest visit kinds, at most six; null under three (a radar needs a shape). */
    fun radar(kinds: List<Pair<String, Long>>): List<Pair<String, Long>>? {
        val top = kinds.filter { it.second > 0 }.sortedByDescending { it.second }.take(MAX_RADAR)
        return top.takeIf { it.size >= MIN_RADAR }
    }

    /** The heat map's hours (at least 9 to 17) and a 7 by hours grid of loads, 0 to 1, Monday first. */
    class HeatGrid(
        val hours: List<Int>,
        val loads: List<List<Float>>,
        val values: List<List<Int>>,
    )

    fun heat(cells: List<HeatCell>): HeatGrid {
        val hours =
            (min(cells.minOfOrNull { it.hour } ?: FIRST_HOUR, FIRST_HOUR))..(
                max(cells.maxOfOrNull { it.hour } ?: LAST_HOUR, LAST_HOUR)
            )
        val list = hours.toList()
        val peak = max(cells.maxOfOrNull { it.value } ?: 1, 1).toFloat()
        val values = List(DAYS_IN_WEEK) { MutableList(list.size) { 0 } }
        for (cell in cells) {
            val column = list.indexOf(cell.hour)
            if (cell.weekday in 1..DAYS_IN_WEEK && column >= 0) values[cell.weekday - 1][column] += cell.value
        }
        return HeatGrid(list, values.map { row -> row.map { min(it / peak, 1f) } }, values)
    }

    /** Monday to Sunday short names. */
    fun weekdays(locale: Locale = Locale.getDefault()): List<String> =
        DayOfWeek.entries.map { it.getDisplayName(TextStyle.SHORT, locale) }

    /** `Tue 17 Nov` for a day, `17 Aug` for a week, `Sep 2026` for a month. */
    fun bucketLabel(
        start: LocalDate,
        bucket: AnalyticsBucketKind,
        locale: Locale = Locale.getDefault(),
    ): String =
        start.toJavaLocalDate().format(
            DateTimeFormatter.ofPattern(
                when (bucket) {
                    AnalyticsBucketKind.Day -> "EEE d MMM"
                    AnalyticsBucketKind.Week -> "d MMM"
                    AnalyticsBucketKind.Month -> "MMM yyyy"
                },
                locale,
            ),
        )

    /**
     * Short axis label: `Tue` or `17` for a day, `17 Aug` for a week, or `Sep` (with a two-digit year
     * when [longRange]).
     */
    fun axisLabel(
        start: LocalDate,
        bucket: AnalyticsBucketKind,
        longRange: Boolean,
        locale: Locale = Locale.getDefault(),
        /** Daily bars of one week read best as weekday names. */
        dayNames: Boolean = true,
    ): String {
        val pattern =
            when {
                bucket == AnalyticsBucketKind.Day -> if (dayNames) "EEE" else "d"
                bucket == AnalyticsBucketKind.Week -> "d MMM"
                longRange -> "MMM yy"
                else -> "MMM"
            }
        return start.toJavaLocalDate().format(DateTimeFormatter.ofPattern(pattern, locale))
    }

    /** `17 Aug` and `15 Nov 2026`: the start drops the year when both ends share it. */
    fun rangeEnds(
        from: LocalDate,
        to: LocalDate,
        locale: Locale = Locale.getDefault(),
    ): Pair<String, String> {
        val short = DateTimeFormatter.ofPattern("d MMM", locale)
        val full = DateTimeFormatter.ofPattern("d MMM yyyy", locale)
        val a = from.toJavaLocalDate()
        val b = to.toJavaLocalDate()
        return a.format(if (a.year == b.year) short else full) to b.format(full)
    }

    /** The axis ticks and bounds a chart draws for values between [low] and [high] (zero is always inside). */
    class Scale(
        val min: Double,
        val max: Double,
        val ticks: List<Double>,
    )

    fun scale(
        low: Double,
        high: Double,
        count: Int = 4,
    ): Scale {
        val lo = min(low, 0.0)
        val hi = max(high, 0.0)
        val span = if (hi - lo <= 0.0) 1.0 else hi - lo
        val step = niceStep(span / count)
        val first = floor(lo / step) * step
        val last = maxOf(ceil(hi / step) * step, first + step)
        val ticks = generateSequence(first) { it + step }.takeWhile { it <= last + step / 2 }.toList()
        return Scale(first, last, ticks)
    }

    private fun niceStep(raw: Double): Double {
        val power = 10.0.pow(floor(log10(raw)))
        val fraction = raw / power
        val nice =
            when {
                fraction <= 1.0 -> 1.0
                fraction <= NICE_TWO -> NICE_TWO
                fraction <= NICE_FIVE -> NICE_FIVE
                else -> BAND_UNIT
            }
        return nice * power
    }

    /** The slot a tap at [fraction] (0 to 1) of the plot width lands in, across [count] equal slots. */
    fun nearest(
        fraction: Float,
        count: Int,
    ): Int = if (count <= 1) 0 else (fraction * count).toInt().coerceIn(0, count - 1)

    /** A date picker's UTC-midnight milliseconds for [day], and back. */
    fun millis(day: LocalDate): Long = day.toJavaLocalDate().toEpochDay() * MILLIS_PER_DAY

    fun day(millis: Long): LocalDate =
        java.time.LocalDate
            .ofEpochDay(Math.floorDiv(millis, MILLIS_PER_DAY))
            .toKotlinLocalDate()

    /** Days between two dates, the span a custom range may not pass. */
    fun spanDays(
        from: LocalDate,
        to: LocalDate,
    ): Int = abs(to.toJavaLocalDate().toEpochDay() - from.toJavaLocalDate().toEpochDay()).toInt() + 1

    /** One decimal for the lab average (`3.5`). */
    fun oneDecimal(value: Double): String = String.format(Locale.US, "%.1f", value)
}
