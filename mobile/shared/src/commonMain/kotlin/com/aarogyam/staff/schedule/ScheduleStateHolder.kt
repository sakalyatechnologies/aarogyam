package com.aarogyam.staff.schedule

import com.aarogyam.staff.calendar.CalendarStateHolder
import com.aarogyam.staff.queue.QueueStateHolder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The Schedule tab's three views. */
enum class ScheduleSegment { Queue, Day, Week }

/** Schedule actions that need server support not built yet; drawn as previews. */
enum class SchedulePreview {
    /** Telling a waiting patient to come in (no call-in endpoint). */
    CallIn,

    /** Choosing the chair when seating the next patient (BK-14). */
    ChairChoice,
}

/**
 * The Schedule tab: Queue, Day and Week, each with its own holder made the first time it is
 * shown, so opening the tab costs one request and switching back costs none.
 */
class ScheduleStateHolder(
    private val makeQueue: () -> QueueStateHolder,
    private val makeDay: () -> CalendarStateHolder,
    private val makeWeek: () -> WeekStateHolder,
    initial: ScheduleSegment = ScheduleSegment.Queue,
) {
    private val mutableSegment = MutableStateFlow(initial)

    /** The segment on screen. */
    val segment: StateFlow<ScheduleSegment> = mutableSegment.asStateFlow()

    /** The queue, created when first shown. */
    val queue: QueueStateHolder by lazy(makeQueue)

    /** The day columns, created when first shown. */
    val day: CalendarStateHolder by lazy(makeDay)

    /** The week heat map, created when first shown. */
    val week: WeekStateHolder by lazy(makeWeek)

    init {
        touch(initial)
    }

    fun show(segment: ScheduleSegment) {
        mutableSegment.value = segment
        touch(segment)
    }

    private fun touch(segment: ScheduleSegment) {
        when (segment) {
            ScheduleSegment.Queue -> queue
            ScheduleSegment.Day -> day
            ScheduleSegment.Week -> week
        }
    }

    companion object {
        /** What the Schedule tab shows as "needs server support". */
        val PREVIEWS: Set<SchedulePreview> = SchedulePreview.entries.toSet()
    }
}
