package com.aarogyam.staff.android.ui.visit

import com.aarogyam.staff.prescriptions.DoseSlot
import com.aarogyam.staff.visit.Bullet
import com.aarogyam.staff.visit.BulletKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VisitLogicTest {
    @Test
    fun tagCyclesAndNewBulletsFollowThePrevious() {
        assertEquals(BulletKind.Finding, NoteTag.next(BulletKind.Dictated))
        assertEquals(BulletKind.Complaint, NoteTag.next(BulletKind.Advice))
        assertEquals(BulletKind.Complaint, NoteTag.kindForNew(emptyList()))
        assertEquals(BulletKind.Finding, NoteTag.kindForNew(listOf(Bullet(1, BulletKind.Finding, "x"))))
        assertEquals(BulletKind.Complaint, NoteTag.kindForNew(listOf(Bullet(1, BulletKind.Dictated, "x"))))
    }

    @Test
    fun doseCellsCycleAndTotalCounts() {
        assertEquals("½-0-1", VisitDose.cycled("0-0-1", DoseSlot.Morning))
        assertEquals("½", VisitDose.cell(1))
        val total = VisitDose.total("1-0-1", 5, "500 mg tablet")
        assertEquals(10, total.count)
        assertNull(VisitDose.total("SOS", 5, "500 mg tablet").count)
        assertNull(VisitDose.total("1-0-1", 5, "5 ml syrup").count)
        assertEquals(90, VisitDose.days(89, 5))
        assertEquals(1, VisitDose.days(1, -1))
    }

    @Test
    fun closeGuardAsksOnlyForAnUnsignedPrescription() {
        assertEquals(CloseDecision.ConfirmUnsigned, CloseGuard.decide(2, false))
        assertEquals(CloseDecision.Close, CloseGuard.decide(2, true))
        assertEquals(CloseDecision.Close, CloseGuard.decide(0, false))
    }

    @Test
    fun moneyAndFormats() {
        assertEquals(150000L, VisitMoney.paise("₹ 1,500"))
        assertNull(VisitMoney.paise(""))
        assertNull(VisitMoney.feePaise("0"))
        assertEquals("1500", VisitMoney.feeText(150000))
        assertEquals("7:05", VisitFormat.timer(425))
        assertEquals("1:02:09", VisitFormat.timer(3729))
        assertEquals("919812345678", VisitFormat.whatsAppDigits("98123 45678"))
        assertEquals("+91 98•••• 5678", VisitFormat.maskedPhone("9812345678"))
    }
}
