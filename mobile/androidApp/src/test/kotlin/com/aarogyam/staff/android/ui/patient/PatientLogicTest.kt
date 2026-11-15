package com.aarogyam.staff.android.ui.patient

import com.aarogyam.staff.chart.Finding
import com.aarogyam.staff.history.BillState
import com.aarogyam.staff.history.VisitKind
import com.aarogyam.staff.patients.MoneySummary
import kotlinx.datetime.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class PatientLogicTest {
    @Test
    fun `tabs follow the permissions`() {
        assertEquals(
            listOf(PatientPageTab.History, PatientPageTab.Consent),
            PatientPageTab.visible(setOf("patients.read")),
        )
        assertEquals(PatientPageTab.entries, PatientPageTab.visible(setOf("patients.read", "clinical.read")))
        assertTrue(PatientPageTab.visible(emptySet()).isEmpty())
    }

    @Test
    fun `money strip is none, closed or open`() {
        val money = MoneySummary(visits = 3, paidPaise = 500_000, remainingPaise = 100_000)
        assertEquals(MoneyStripModel.None, MoneyStripModel.make(null, shown = true))
        assertEquals(MoneyStripModel.Closed, MoneyStripModel.make(money, shown = false))
        val open = MoneyStripModel.make(money, shown = true) as MoneyStripModel.Open
        assertEquals("3", open.visits)
        assertTrue(open.hasDue)
        assertTrue(!(MoneyStripModel.make(money.copy(remainingPaise = 0), true) as MoneyStripModel.Open).hasDue)
    }

    @Test
    fun `badge shows today or day and month`() {
        val today = LocalDate(2026, 11, 15)
        assertTrue(HistoryRowFormat.badge(today, today).isToday)
        val old = HistoryRowFormat.badge(LocalDate(2026, 10, 5), today, Locale.ENGLISH)
        assertEquals("5", old.top)
        assertEquals("Oct", old.bottom)
    }

    @Test
    fun `chips list what the visit holds`() {
        val chips =
            HistoryRowFormat.chips(
                hasNotes = true,
                hasRx = true,
                hasPhotos = false,
                bill = BillState.Paid,
                open = true,
                teeth = listOf(36, 46),
            )
        assertEquals(
            listOf(
                HistoryChip.Open,
                HistoryChip.Tooth(36),
                HistoryChip.Tooth(46),
                HistoryChip.Notes,
                HistoryChip.Rx,
                HistoryChip.Paid,
            ),
            chips,
        )
        assertEquals(listOf(HistoryChip.Due), HistoryRowFormat.chips(null, false, null, BillState.Due, false))
        assertTrue(
            HistoryRowFormat
                .chips(
                    null,
                    false,
                    null,
                    BillState.Due,
                    false,
                    duePaise = 600_000,
                ).single() is HistoryChip.DueAmount,
        )
        assertNull(HistoryRowFormat.dueText(100, moneyVisible = false))
        assertNull(HistoryRowFormat.dueText(0, moneyVisible = true))
    }

    @Test
    fun `title prefers the complaint then the procedure`() {
        assertEquals(HistoryTitle.Text("Pain"), HistoryRowFormat.title(" Pain ", "Filling", VisitKind.WalkIn))
        assertEquals(HistoryTitle.Text("Filling"), HistoryRowFormat.title("  ", "Filling", null))
        assertEquals(HistoryTitle.WalkIn, HistoryRowFormat.title(null, null, VisitKind.WalkIn))
        assertEquals(HistoryTitle.Appointment, HistoryRowFormat.title(null, "", VisitKind.Appointment))
        assertEquals(HistoryTitle.Visit, HistoryRowFormat.title(null, null, null))
    }

    @Test
    fun `links carry digits only`() {
        assertEquals("tel:+919876543210", PatientLinks.tel("+91 98765-43210"))
        assertEquals("tel:9876543210", PatientLinks.tel("98765 43210"))
        assertNull(PatientLinks.tel(" "))
        assertNull(PatientLinks.tel(null))
        assertEquals("https://wa.me/919876543210", PatientLinks.whatsApp("98765 43210"))
        assertEquals("https://wa.me/919876543210", PatientLinks.whatsApp("+91 98765 43210"))
        assertNull(PatientLinks.whatsApp("12345"))
    }

    @Test
    fun `booking days start today`() {
        val days = BookingDays.next(3, LocalDate(2026, 12, 30))
        assertEquals(listOf(LocalDate(2026, 12, 30), LocalDate(2026, 12, 31), LocalDate(2027, 1, 1)), days)
    }

    @Test
    fun `tones and quadrants`() {
        assertEquals(JawTone.Treated, JawTone.of(Finding.Crown))
        assertEquals(JawTone.Care, JawTone.of(Finding.Caries))
        assertEquals(JawTone.Missing, JawTone.of(Finding.Missing))
        assertEquals(Quadrant.LowerRight, Quadrant.of(46))
        assertEquals(Quadrant.UpperLeft, Quadrant.of(62))
    }
}
