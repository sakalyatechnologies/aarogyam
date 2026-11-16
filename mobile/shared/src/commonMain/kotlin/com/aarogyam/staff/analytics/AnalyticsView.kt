package com.aarogyam.staff.analytics

import kotlinx.datetime.LocalDate

/** A number against the same-length range before it. [previous] and [deltaPercent] are null until that range is known or when it was zero. */
data class Kpi(
    val value: Long,
    val previous: Long?,
    val deltaPercent: Int?,
)

/** One week or month. Money is null without `finance.view`. */
data class AnalyticsPoint(
    val start: LocalDate,
    val newPatients: Int,
    val returningPatients: Int,
    val incomePaise: Long?,
    val expensesPaise: Long?,
) {
    val patientVisits: Int get() = newPatients + returningPatients
    val netPaise: Long? get() = if (incomePaise == null || expensesPaise == null) null else incomePaise - expensesPaise
}

/** One key of a breakdown (age band, sex, visit kind, expense category). */
data class Share(
    val key: String,
    val value: Long,
)

/** One procedure category; [amountPaise] only with `finance.view`. */
data class ProcedureShare(
    val key: String,
    val count: Long,
    val amountPaise: Long?,
)

/** One chair over the range: [percent] is booked over open minutes (can pass 100). */
data class ChairUse(
    val id: String,
    val name: String,
    val bookedMinutes: Long,
    val openMinutes: Long,
    val appointments: Long,
    val percent: Int,
)

/** One slice of the chair-time split: key is `treatment`, `consult` or `admin`. */
data class ChairSlice(
    val key: String,
    val minutes: Long,
    val percent: Int,
)

/** Booked against walk-in visits; [bookedPercent] is null when there were none. */
data class VisitSplit(
    val booked: Long,
    val walkIn: Long,
    val bookedPercent: Int?,
)

/** Lab orders received and their average turnaround in days (null with none finished). */
data class LabStats(
    val orders: Long,
    val averageDays: Double?,
)

/** One heat-map cell: ISO weekday 1 to 7, clinic hour 0 to 23, and its [value] in the view's [HeatUnit]. */
data class HeatCell(
    val weekday: Int,
    val hour: Int,
    val value: Int,
)

/** What a heat-map cell counts. */
enum class HeatUnit {
    /** Chair minutes booked. */
    BookedMinutes,

    /** Patient visits, when the server sent no occupancy. */
    Visits,
}

/** Everything the Analytics page draws for one range. */
data class AnalyticsView(
    val range: AnalyticsRange,
    val bucket: AnalyticsBucketKind,
    /** True when nothing happened in the range: show an empty state, not zeros. */
    val isEmpty: Boolean,
    val points: List<AnalyticsPoint>,
    /** Visits by new plus returning patients ("patient visits", not unique people). */
    val patientVisits: Kpi,
    val newPatients: Kpi,
    /** The money below is null (or empty) without `finance.view`. */
    val revenue: Kpi?,
    val expenses: Kpi?,
    val netPaise: Long?,
    val payments: Long?,
    val expensesByCategory: List<Share>,
    /** Booked minutes per appointment, or null without appointments. */
    val avgChairMinutes: Int?,
    /** Booked over open minutes, 0 to 1 (can pass 1). */
    val chairUtilization: Float,
    val chairs: List<ChairUse>,
    val chairTime: List<ChairSlice>,
    val heat: List<HeatCell>,
    val heatUnit: HeatUnit,
    val visitSources: VisitSplit,
    val procedures: List<ProcedureShare>,
    val visitKinds: List<Share>,
    val ageBands: List<Share>,
    val sex: List<Share>,
    val lab: LabStats,
)
