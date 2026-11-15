package com.aarogyam.staff.android.ui.labs

import org.junit.Assert.assertEquals
import org.junit.Test

class LabsLogicTest {
    @Test
    fun stepsMarkDoneCurrentAndTodo() {
        assertEquals(
            listOf(TrackerStep.Done, TrackerStep.Done, TrackerStep.Current, TrackerStep.Todo, TrackerStep.Todo),
            trackerSteps(2),
        )
        assertEquals(List(5) { TrackerStep.Todo }, trackerSteps(null))
        assertEquals(TrackerStep.Current, trackerSteps(4).last())
    }

    @Test
    fun teethParseFdiNumbers() {
        assertEquals(listOf(46, 47), parseTeeth("46, 47 47"))
        assertEquals(emptyList<Int>(), parseTeeth("99 x"))
    }
}
