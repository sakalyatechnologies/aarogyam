package com.aarogyam.staff.analytics

import com.aarogyam.staff.api.model.Analytics
import com.aarogyam.staff.api.model.AnalyticsBucketRow
import kotlinx.datetime.LocalDate

/** The Analytics period switch. */
enum class AnalyticsPeriod {
    /** 12 weekly bars; numbers are this week against last week. */
    Week,

    /** 12 monthly bars; numbers are this month against last month. */
    Month,

    /** 24 monthly bars; numbers are the last 12 months against the 12 before. */
    Year,
}

/** Parts of the v7 Analytics page the server cannot fill yet; drawn as previews. */
enum class AnalyticsPreview {
    /** Chair time as treatment, consults and admin (BK-4). */
    ChairTimeSplit,

    /** Booked against walk-in visits (BK-19). */
    BookedVsWalkIn,

    /** Patients by sex (BK-4). */
    SexSplit,

    /** Treatment mix by procedure category (BK-4); the radar shows visit kinds meanwhile. */
    ProcedureCategories,
}

/** A number against the same-sized period before it. [deltaPercent] is null when there is nothing to compare. */
data class Kpi(
    val value: Long,
    val previous: Long,
    val deltaPercent: Int?,
)

/** One bar: a week or month. */
data class AnalyticsBar(
    val start: LocalDate,
    val patientVisits: Int,
    val newPatients: Int,
    /** Null without `finance.view`. */
    val incomePaise: Long?,
)

/** One key of a breakdown (age band, visit kind, expense category). */
data class Share(
    val key: String,
    val value: Long,
)

/** One heat-map cell: ISO weekday 1–7 and clinic hour 0–23. */
data class BusyCell(
    val weekday: Int,
    val hour: Int,
    val visits: Int,
)

/** Everything the Analytics page draws for one period. */
data class AnalyticsView(
    val period: AnalyticsPeriod,
    val bars: List<AnalyticsBar>,
    /** Visits by new plus returning patients ("patient visits", not unique people). */
    val patientVisits: Kpi,
    val newPatients: Kpi,
    /** Null without `finance.view`. */
    val revenue: Kpi?,
    val expenses: Kpi?,
    val expensesByCategory: List<Share>,
    /** Booked minutes per appointment in the current window, or null without appointments. */
    val avgChairMinutes: Int?,
    /** Booked over open minutes in the current window, 0 to 1 (can pass 1). */
    val chairUtilization: Float,
    val busyHours: List<BusyCell>,
    val visitKinds: List<Share>,
    val ageBands: List<Share>,
) {
    companion object {
        val PREVIEWS: Set<AnalyticsPreview> = AnalyticsPreview.entries.toSet()
    }
}

/** How many buckets form the "current" window of [period], and how many bars it draws. */
internal fun windowOf(period: AnalyticsPeriod): Int =
    when (period) {
        AnalyticsPeriod.Week, AnalyticsPeriod.Month -> 1
        AnalyticsPeriod.Year -> YEAR_MONTHS
    }

internal fun barsOf(period: AnalyticsPeriod): Int =
    when (period) {
        AnalyticsPeriod.Week, AnalyticsPeriod.Month -> BARS
        AnalyticsPeriod.Year -> 2 * YEAR_MONTHS
    }

internal fun Analytics.toView(period: AnalyticsPeriod): AnalyticsView {
    val rows = buckets
    val window = windowOf(period)
    val current = rows.takeLast(window)
    val previous = rows.dropLast(window).takeLast(window)

    fun kpi(of: (AnalyticsBucketRow) -> Long): Kpi {
        val now = current.sumOf(of)
        val before = previous.sumOf(of)
        val delta = if (previous.isEmpty() || before == 0L) null else (((now - before) * PERCENT) / before).toInt()
        return Kpi(now, before, delta)
    }
    val visits: (AnalyticsBucketRow) -> Long = { it.patients.new + it.patients.returning }
    val booked = current.sumOf { r -> r.chairUtilization.sumOf { it.bookedMinutes } }
    val open = current.sumOf { r -> r.chairUtilization.sumOf { it.openMinutes } }
    val appointments = current.sumOf { r -> r.chairUtilization.sumOf { it.appointments } }
    return AnalyticsView(
        period = period,
        bars =
            rows.takeLast(barsOf(period)).map {
                AnalyticsBar(
                    LocalDate.parse(it.start),
                    visits(it).toInt(),
                    it.patients.new.toInt(),
                    if (moneyVisible) {
                        it.incomePaise
                            ?: 0
                    } else {
                        null
                    },
                )
            },
        patientVisits = kpi(visits),
        newPatients = kpi { it.patients.new },
        revenue = if (moneyVisible) kpi { it.incomePaise ?: 0 } else null,
        expenses = if (moneyVisible) kpi { it.expensesPaise ?: 0 } else null,
        expensesByCategory =
            current
                .flatMap { it.expenses.orEmpty() }
                .groupBy { it.category.value }
                .map { (k, v) -> Share(k, v.sumOf { it.amountPaise }) }
                .sortedByDescending { it.value },
        avgChairMinutes = if (appointments == 0L) null else (booked / appointments).toInt(),
        chairUtilization = if (open == 0L) 0f else booked.toFloat() / open,
        busyHours = busyHours.map { BusyCell(it.weekday, it.hour, it.visits.toInt()) },
        visitKinds = patients.visitKinds.map { Share(it.key, it.count) },
        ageBands = patients.ageBands.map { Share(it.key, it.count) },
    )
}

private const val BARS = 12
private const val YEAR_MONTHS = 12
private const val PERCENT = 100
