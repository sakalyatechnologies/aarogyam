package com.aarogyam.staff.android.ui.patient

import com.aarogyam.staff.prescriptions.RxTiming
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DoseDisplayTest {
    @Test
    fun `halves read as tablets`() {
        assertEquals("0", DoseDisplay.halvesText(0))
        assertEquals("½", DoseDisplay.halvesText(1))
        assertEquals("1", DoseDisplay.halvesText(2))
        assertEquals("1½", DoseDisplay.halvesText(3))
    }

    @Test
    fun `a dose fills the cells and the total`() {
        val display = DoseDisplay.make("1-0-1", "after_food", 5, "tablet")
        assertEquals(listOf("1", "0", "1"), display.cells.map { it.value })
        assertEquals(listOf(true, false, true), display.cells.map { it.on })
        assertEquals(10, display.total)
        assertEquals(RxTiming.AfterFood, display.timing)
        assertFalse(display.upTo)
    }

    @Test
    fun `an unknown frequency leaves dashes and keeps the raw timing`() {
        val display = DoseDisplay.make("as needed", "whenever", null, "gel")
        assertTrue(display.cells.all { it.value == "–" && !it.on })
        assertNull(display.total)
        assertEquals("whenever", display.rawTiming)
    }

    @Test
    fun `sos totals are an upper bound`() {
        assertTrue(DoseDisplay.make("1-1-1", "sos", 2, "tablet").upTo)
    }
}
