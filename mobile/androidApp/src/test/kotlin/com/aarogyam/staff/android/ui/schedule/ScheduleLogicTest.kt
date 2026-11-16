package com.aarogyam.staff.android.ui.schedule

import com.aarogyam.staff.today.VisitStatus
import kotlinx.datetime.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ScheduleLogicTest {
    @Test
    fun freeChairsUsesCapacityOrOffersOne() {
        assertEquals(1, QueueBoard.freeChairs(chairs = 0, occupied = 0, waiting = 2))
        assertEquals(0, QueueBoard.freeChairs(chairs = 0, occupied = 0, waiting = 0))
        assertEquals(2, QueueBoard.freeChairs(chairs = 4, occupied = 2, waiting = 0))
        assertEquals(0, QueueBoard.freeChairs(chairs = 2, occupied = 3, waiting = 1))
    }

    @Test
    fun waitGrowsWithElapsedTime() {
        assertEquals(12, QueueBoard.waitMinutes(base = 10, elapsedMillis = 125_000))
        assertEquals(0, QueueBoard.waitMinutes(base = -3, elapsedMillis = -5))
    }

    @Test
    fun hoursWidenAroundAppointments() {
        assertEquals(9..18, DayGrid.hours(emptyList(), emptyList()))
        assertEquals(8..20, DayGrid.hours(listOf(8 * 60 + 30), listOf(20 * 60 + 10)))
    }

    @Test
    fun frameAndNowLine() {
        val (top, height) = DayGrid.frame(start = 10 * 60, end = 11 * 60, firstHour = 9)
        assertEquals(50f, top, 0.01f)
        assertEquals(44f, height, 0.01f)
        assertNull(DayGrid.nowOffset(8 * 60, 9..18))
        assertEquals(24f, DayGrid.nowOffset(9 * 60 + 30, 9..18) ?: -1f, 0.01f)
    }

    @Test
    fun lanesSplitOverlaps() {
        val lanes = DayGrid.lanes(listOf(540 to 600, 570 to 630, 660 to 700))
        assertEquals(listOf(DayGrid.Lane(0, 2), DayGrid.Lane(1, 2), DayGrid.Lane(0, 1)), lanes)
    }

    @Test
    fun weekStartsOnMonday() {
        val week = DayGrid.week(LocalDate(2026, 11, 15))
        assertEquals(LocalDate(2026, 11, 9), week.first())
        assertEquals(LocalDate(2026, 11, 15), week.last())
        assertEquals(DayGrid.Tone.Warm, DayGrid.tone(VisitStatus.InChair))
        assertEquals("12 pm", DayGrid.hourLabel(12))
        assertEquals("1", DayGrid.hourLabel(13))
    }
}
