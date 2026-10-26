package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.api.model.RxItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RxDosingTest {
    @Test
    fun parseAndFormatRoundTrip() {
        assertEquals(RxDose(2, 0, 2), RxDose.parse("1-0-1"))
        assertEquals("1-0-1", RxDose.parse("1-0-1")?.format())
        assertEquals(RxDose(1, 0, 1), RxDose.parse("½-0-½"))
        assertEquals("½-0-½", RxDose.parse("½-0-½")?.format())
        assertEquals(RxDose(1, 0, 2), RxDose.parse("0.5-0-1"))
        assertEquals("½-0-1", RxDose.parse("0.5-0-1")?.format())
        assertEquals(RxDose(4, 2, 4), RxDose.parse(" 2 - 1 - 2 "))
    }

    @Test
    fun unknownFormatsAreNull() {
        listOf("", "twice daily", "1-1", "1-1-1-1", "3-0-0", "a-b-c", "1.5-0-0").forEach {
            assertNull(RxDose.parse(it), it)
        }
        assertNull(RxDose.parse(null))
    }

    @Test
    fun cycleWalksTheSteps() {
        var dose = RxDose(0, 0, 0)
        val seen = mutableListOf<Int>()
        repeat(5) {
            dose = dose.cycle(DoseSlot.Afternoon)
            seen += dose.afternoon
        }
        assertEquals(listOf(1, 2, 4, 0, 1), seen)
        assertEquals(0, dose.morning)
    }

    @Test
    fun totals() {
        assertEquals(10, unitsTotal(RxDose(2, 0, 2), 5, "tablet"))
        assertEquals(4, unitsTotal(RxDose(1, 0, 1), 4, "Tablets"))
        assertEquals(3, unitsTotal(RxDose(1, 0, 0), 5, "capsule"))
        assertNull(unitsTotal(RxDose(2, 0, 2), 5, "rinse"))
        assertNull(unitsTotal(RxDose(2, 0, 2), 5, "gel"))
        assertNull(unitsTotal(RxDose(2, 0, 2), 5, "syrup"))
        assertNull(unitsTotal(RxDose(2, 0, 2), 5, null))
    }

    @Test
    fun timingMapsBothWays() {
        RxTiming.entries.forEach { assertEquals(it, RxTiming.fromApi(it.api)) }
        assertEquals("empty_stomach", RxTiming.EmptyStomach.api)
        assertNull(RxTiming.fromApi("whenever"))
        assertNull(RxTiming.fromApi(null))
    }

    @Test
    fun validity() {
        val base = RxLineDraft(form = "tablet", dose = RxDose(2, 0, 2))
        assertTrue(base.isValid)
        assertFalse(base.copy(dose = RxDose(0, 0, 0)).isValid)
        assertTrue(base.copy(days = 1).isValid)
        assertTrue(base.copy(days = 90).isValid)
        assertFalse(base.copy(days = 0).isValid)
        assertFalse(base.copy(days = 91).isValid)
        assertEquals(90, base.withDays(400).days)
        assertEquals(1, base.withDays(-3).days)
        val sos = base.copy(dose = null, timing = RxTiming.Sos)
        assertTrue(sos.isValid)
        assertFalse(base.copy(dose = null, rawFrequency = null).isValid)
    }

    @Test
    fun draftRoundTripsThroughTheItem() {
        val item =
            RxItem(
                drugId = "d1",
                drugName = "PARACETAMOL",
                dose = "1 tablet",
                frequency = "0.5-0-1",
                durationDays = 4,
                form = "tablet",
                instructions = "with water",
                strength = "500 mg",
                timing = "after_food",
            )
        val draft = RxLineDraft.fromItem(item)
        assertEquals(RxTiming.AfterFood, draft.timing)
        assertEquals(RxDose(1, 0, 2), draft.dose)
        assertEquals(6, draft.total)
        assertEquals(item.copy(frequency = "½-0-1"), draft.toItem())
    }

    @Test
    fun unknownTextSurvivesTheRoundTrip() {
        val item = RxItem(drugName = "X", frequency = "every 6 hours", durationDays = 3, timing = "weekly")
        val draft = RxLineDraft.fromItem(item)
        assertNull(draft.dose)
        assertNull(draft.timing)
        assertEquals(item, draft.toItem())
        assertNull(draft.total)
        assertEquals("1-0-0", draft.cycled(DoseSlot.Morning).cycled(DoseSlot.Morning).frequencyText)
    }
}
