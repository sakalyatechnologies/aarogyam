package com.aarogyam.staff.android.ui.desk

import com.aarogyam.staff.desk.PatientState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

class DeskLogicTest {
    @Test
    fun phoneDropsPrefixesAndGroups() {
        assertEquals("9876543210", DeskPhone.digits("+91 98765-43210"))
        assertEquals("9876543210", DeskPhone.digits("09876543210"))
        assertEquals("98765 43210", DeskPhone.format("9876543210"))
        assertEquals("98765", DeskPhone.format("98765"))
    }

    @Test
    fun payAmountParsing() {
        assertEquals(125000L, DeskPay.paise("1,250"))
        assertEquals(125050L, DeskPay.paise("1250.5"))
        assertNull(DeskPay.paise("0"))
        assertNull(DeskPay.paise("12.345"))
        assertNull(DeskPay.paise(""))
        assertEquals("1250.5", DeskPay.rupeesText(125050))
        assertEquals("1250.05", DeskPay.rupeesText(125005))
        assertEquals(listOf(DeskPayProblem.Amount, DeskPayProblem.Method), DeskPay.problems("x", false))
    }

    @Test
    fun doctorPick() {
        val docs = listOf(DeskDoctor("a", "A", false), DeskDoctor("b", "B", true))
        assertEquals("b", DeskDoctors.pick(docs, "a", null)?.id)
        assertEquals("a", DeskDoctors.pick(docs, "a", "a")?.id)
        assertEquals("a", DeskDoctors.pick(listOf(docs[0]), "a", null)?.id)
        assertTrue(DeskDoctors.hasTitle("Dr. Patil"))
        assertFalse(DeskDoctors.hasTitle("Drake"))
    }

    @Test
    fun boardRules() {
        assertTrue(DeskBoardRules.showsSendIn("doctor", PatientState.Waiting))
        assertFalse(DeskBoardRules.showsSendIn("front_desk", PatientState.Waiting))
        assertTrue(DeskBoardRules.showsCalledBanner("front_desk", 1))
        assertFalse(DeskBoardRules.showsCalledBanner("doctor", 2))
    }

    @Test
    fun collectingWindow() {
        val ended = Instant.parse("2026-11-15T10:00:00Z")
        assertTrue(DeskCollect.mayBeCollecting(ended, Instant.parse("2026-11-15T10:01:59Z")))
        assertFalse(DeskCollect.mayBeCollecting(ended, Instant.parse("2026-11-15T10:02:00Z")))
        assertFalse(DeskCollect.mayBeCollecting(null, ended))
        assertTrue(DeskCollect.canCollect(setOf("billing.read", "billing.write")))
        assertFalse(DeskCollect.canCollect(setOf("billing.read")))
    }

    @Test
    fun earlierText() {
        assertFalse(DeskEarlier.startsCollapsed(3))
        assertTrue(DeskEarlier.startsCollapsed(4))
        assertEquals("not a day", DeskEarlier.dayText("not a day"))
        assertEquals(555, minuteOfDay("2026-11-15T03:45:00Z", "Asia/Kolkata"))
        assertEquals("#7 · SC-1 · Dr. P", DeskAlert.detail(7, "SC-1", "Dr. P"))
    }

    @Test
    fun intakeDate() {
        assertEquals("1990-05-07", intakeDateText("19900507"))
        assertEquals("1990-0", intakeDateText("1990-0"))
        assertEquals("1990-05-07", intakeDateText("1990-05-07999"))
    }
}
