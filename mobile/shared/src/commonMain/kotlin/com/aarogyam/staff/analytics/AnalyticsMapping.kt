package com.aarogyam.staff.analytics

import com.aarogyam.staff.api.model.Analytics
import com.aarogyam.staff.api.model.AnalyticsBucketRow
import kotlinx.datetime.LocalDate

private const val PERCENT = 100

private fun percentOf(
    part: Long,
    whole: Long,
): Int = if (whole <= 0L) 0 else ((part * PERCENT + whole / 2) / whole).toInt()

private fun kpi(
    now: Long,
    before: Long?,
): Kpi {
    val delta = if (before == null || before == 0L) null else (((now - before) * PERCENT) / before).toInt()
    return Kpi(now, before, delta)
}

private fun List<AnalyticsBucketRow>.sumOfRows(of: (AnalyticsBucketRow) -> Long): Long = sumOf(of)

private val visits: (AnalyticsBucketRow) -> Long = { it.patients.new + it.patients.returning }

/**
 * The page for [range] from [this] (the server's answer for exactly that range); [previous] is the
 * answer for [AnalyticsRange.previous], or null while it loads or failed (no deltas then).
 */
internal fun Analytics.toView(
    range: AnalyticsRange,
    previous: Analytics?,
): AnalyticsView {
    val rows = buckets
    val before = previous?.buckets
    val booked = rows.sumOf { r -> r.chairUtilization.sumOf { it.bookedMinutes } }
    val open = rows.sumOf { r -> r.chairUtilization.sumOf { it.openMinutes } }
    val appointments = rows.sumOf { r -> r.chairUtilization.sumOf { it.appointments } }
    val income = if (moneyVisible) rows.sumOfRows { it.incomePaise ?: 0 } else null
    val spent = if (moneyVisible) rows.sumOfRows { it.expensesPaise ?: 0 } else null
    val chairTimeTotal = chairTime.treatment + chairTime.consult + chairTime.admin
    val heatCells =
        occupancy
            ?.byWeekdayHour
            .orEmpty()
            .filter { it.bookedMinutes > 0 }
            .map { HeatCell(it.weekday, it.hour, it.bookedMinutes.toInt()) }
    val kinds = patients.visitKinds.map { Share(it.key, it.count) }
    return AnalyticsView(
        range = range,
        bucket = range.bucket,
        isEmpty =
            rows.sumOfRows(visits) == 0L && booked == 0L && (income ?: 0L) == 0L && (spent ?: 0L) == 0L &&
                kinds.sumOf { it.value } == 0L,
        points =
            rows.map {
                AnalyticsPoint(
                    start = LocalDate.parse(it.start),
                    newPatients = it.patients.new.toInt(),
                    returningPatients = it.patients.returning.toInt(),
                    incomePaise = if (moneyVisible) it.incomePaise ?: 0 else null,
                    expensesPaise = if (moneyVisible) it.expensesPaise ?: 0 else null,
                )
            },
        patientVisits = kpi(rows.sumOfRows(visits), before?.sumOfRows(visits)),
        newPatients = kpi(rows.sumOfRows { it.patients.new }, before?.sumOfRows { it.patients.new }),
        revenue = income?.let { kpi(it, before?.sumOfRows { r -> r.incomePaise ?: 0 }) },
        expenses = spent?.let { kpi(it, before?.sumOfRows { r -> r.expensesPaise ?: 0 }) },
        netPaise = if (income != null && spent != null) income - spent else null,
        payments = if (moneyVisible) rows.sumOfRows { it.payments ?: 0 } else null,
        expensesByCategory =
            rows
                .flatMap { it.expenses.orEmpty() }
                .groupBy { it.category.value }
                .map { (k, v) -> Share(k, v.sumOf { it.amountPaise }) }
                .filter { it.value > 0 }
                .sortedWith(compareByDescending<Share> { it.value }.thenBy { it.key }),
        avgChairMinutes = if (appointments == 0L) null else (booked / appointments).toInt(),
        chairUtilization = if (open == 0L) 0f else booked.toFloat() / open,
        chairs =
            chairs.map { chair ->
                val use = rows.flatMap { r -> r.chairUtilization.filter { it.roomId == chair.id } }
                val chairBooked = use.sumOf { it.bookedMinutes }
                val chairOpen = use.sumOf { it.openMinutes }
                ChairUse(
                    chair.id,
                    chair.name,
                    chairBooked,
                    chairOpen,
                    use.sumOf { it.appointments },
                    percentOf(chairBooked, chairOpen),
                )
            },
        chairTime =
            listOf("treatment" to chairTime.treatment, "consult" to chairTime.consult, "admin" to chairTime.admin)
                .filter { chairTimeTotal > 0 }
                .map { (key, minutes) -> ChairSlice(key, minutes, percentOf(minutes, chairTimeTotal)) },
        heat = heatCells.ifEmpty { busyHours.map { HeatCell(it.weekday, it.hour, it.visits.toInt()) } },
        heatUnit = if (heatCells.isNotEmpty()) HeatUnit.BookedMinutes else HeatUnit.Visits,
        visitSources =
            VisitSplit(
                visitSources.booked,
                visitSources.walkIn,
                (visitSources.booked + visitSources.walkIn).let {
                    if (it ==
                        0L
                    ) {
                        null
                    } else {
                        percentOf(visitSources.booked, it)
                    }
                },
            ),
        procedures =
            proceduresByCategory
                .map { ProcedureShare(it.key, it.count, if (moneyVisible) it.amountPaise else null) }
                .sortedWith(compareByDescending<ProcedureShare> { it.count }.thenBy { it.key }),
        visitKinds = kinds,
        ageBands = patients.ageBands.map { Share(it.key, it.count) },
        sex = patients.sex.map { Share(it.key, it.count) }.sortedByDescending { it.value },
        lab = LabStats(labTurnaround.ordersReceived, labTurnaround.averageDays),
    )
}
