package com.aarogyam.staff.android.ui.schedule

import com.aarogyam.staff.today.VisitStatus
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDate
import kotlinx.datetime.plus
import kotlin.math.max

/** The Queue view's chair maths (iOS `QueueBoard`). */
object QueueBoard {
    /**
     * Chairs with nobody in them. The clinic's chair list is the capacity; when it is not known,
     * one free chair is offered while somebody waits so "Seat next" stays reachable.
     */
    fun freeChairs(
        chairs: Int,
        occupied: Int,
        waiting: Int,
    ): Int =
        if (chairs <= 0) {
            if (waiting > 0) {
                1
            } else {
                0
            }
        } else {
            max(chairs - occupied, 0)
        }

    /** A ticket's wait now: the minutes the server reported plus the time since they were read. */
    fun waitMinutes(
        base: Int,
        elapsedMillis: Long,
    ): Int = max(base, 0) + max((elapsedMillis / MILLIS_PER_MINUTE).toInt(), 0)

    private const val MILLIS_PER_MINUTE = 60_000L
}

/** The Day view's time grid maths (iOS `DayGrid`). */
object DayGrid {
    const val HOUR_HEIGHT = 48

    /** The clinic's usual day, widened when appointments fall outside it. */
    private val usual = 9..18

    /** The hours to draw: the usual day plus any appointment outside it. */
    fun hours(
        starts: List<Int>,
        ends: List<Int>,
    ): IntRange {
        val first = minOf(usual.first, (starts.minOrNull() ?: (usual.first * MIN)) / MIN)
        val last = maxOf(usual.last, ((ends.maxOrNull() ?: 0) + MIN - 1) / MIN - 1)
        return first..max(first, last)
    }

    /** Top and height in dp of an appointment in its column, with the mock-up's 2 and 4 point insets. */
    fun frame(
        start: Int,
        end: Int,
        firstHour: Int,
    ): Pair<Float, Float> {
        val top = (start - firstHour * MIN).toFloat() / MIN * HOUR_HEIGHT + 2
        val height = max(max(end - start, MIN_SPAN).toFloat() / MIN * HOUR_HEIGHT - 4, MIN_HEIGHT)
        return top to height
    }

    /** The "now" line's offset in dp, or null outside the drawn hours. */
    fun nowOffset(
        minute: Int,
        hours: IntRange,
    ): Float? =
        if (minute < hours.first * MIN || minute > (hours.last + 1) * MIN) {
            null
        } else {
            (minute - hours.first * MIN).toFloat() / MIN * HOUR_HEIGHT
        }

    /** How an appointment block looks: normal, waiting or in the chair (warm), finished (grey). */
    enum class Tone { Normal, Warm, Finished }

    fun tone(status: VisitStatus): Tone =
        when (status) {
            VisitStatus.Arrived, VisitStatus.InChair -> Tone.Warm
            VisitStatus.Completed, VisitStatus.NoShow, VisitStatus.Cancelled -> Tone.Finished
            else -> Tone.Normal
        }

    /** One appointment's lane and how many lanes its overlapping group needs. */
    data class Lane(
        val lane: Int,
        val count: Int,
    )

    /** Side-by-side lanes for overlapping appointments in one column; input is in start order. */
    fun lanes(spans: List<Pair<Int, Int>>): List<Lane> {
        val lane = IntArray(spans.size)
        val count = IntArray(spans.size) { 1 }
        var group = mutableListOf<Int>()
        var laneEnds = mutableListOf<Int>()

        fun close() {
            group.forEach { count[it] = max(laneEnds.size, 1) }
            group = mutableListOf()
            laneEnds = mutableListOf()
        }
        spans.forEachIndexed { index, span ->
            val last = group.maxOfOrNull { spans[it].second }
            if (last != null && span.first >= last) close()
            val free = laneEnds.indexOfFirst { it <= span.first }
            if (free >= 0) {
                laneEnds[free] = span.second
                lane[index] = free
            } else {
                laneEnds.add(span.second)
                lane[index] = laneEnds.size - 1
            }
            group.add(index)
        }
        close()
        return spans.indices.map { Lane(lane[it], count[it]) }
    }

    /** `12 pm`, `9`, `1`: the hour labels down the side. */
    fun hourLabel(hour: Int): String =
        if (hour ==
            NOON
        ) {
            "12 pm"
        } else {
            (if (hour > NOON) hour - NOON else hour).toString()
        }

    /** The seven days of the Monday-to-Sunday week holding [day]. */
    fun week(day: LocalDate): List<LocalDate> {
        val sinceMonday = day.dayOfWeek.ordinal - DayOfWeek.MONDAY.ordinal
        return (0 until DAYS).map { day.plus(DatePeriod(days = it - sinceMonday)) }
    }

    private const val MIN = 60
    private const val MIN_SPAN = 15
    private const val MIN_HEIGHT = 24f
    private const val NOON = 12
    private const val DAYS = 7
}
