package com.aarogyam.staff.android.ui

import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.live.LiveLogic
import com.aarogyam.staff.android.ui.tasks.BellFilter
import com.aarogyam.staff.android.ui.tasks.TasksFormat
import com.aarogyam.staff.android.ui.today.TodayLogic
import com.aarogyam.staff.android.ui.today.bookingUrl
import com.aarogyam.staff.team.AlertRow
import com.sakalya.mobile.designcompose.SkTone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

class ShellLogicTest {
    @Test
    fun desk_permissions_without_clinical_write_use_the_desk_home() {
        assertTrue(TodayLogic.usesDesk(setOf("appointments.write")))
        assertFalse(TodayLogic.usesDesk(setOf("appointments.write", "clinical.write")))
        assertTrue(TodayLogic.showsWaitingCard(setOf("clinical.write")))
        assertTrue(TodayLogic.showsTasks(setOf("tasks.use")))
        // Doctors and owners don't get it by default.
        assertFalse(TodayLogic.showsTasks(setOf("tasks.use", "clinical.write")))
        assertFalse(TodayLogic.showsTasks(emptySet()))
    }

    @Test
    fun live_lines_use_the_token_only_when_there_is_one() {
        assertEquals(R.string.sh_lv10_sendin, LiveLogic.line("send_in", 7)?.res)
        assertEquals(R.string.sh_lv10_sendin_nonumber, LiveLogic.line("send_in", null)?.res)
        assertNull(LiveLogic.line("task_due", 3))
    }

    @Test
    fun quantity_is_whole_positive_units() {
        assertEquals(3L, TasksFormat.quantity(" 3 "))
        assertNull(TasksFormat.quantity("0"))
        assertNull(TasksFormat.quantity(""))
    }

    @Test
    fun due_text_is_the_time_today_and_adds_the_day_otherwise() {
        val zone = ZoneId.of("UTC")
        val now = Instant.parse("2026-11-15T08:00:00Z")
        val today = TasksFormat.dueText("2026-11-15T16:30:00Z", zone, now, Locale.US)
        val later = TasksFormat.dueText("2026-11-17T16:30:00Z", zone, now, Locale.US)
        assertTrue(today != null && !today.contains("Nov"))
        assertTrue(later != null && later.contains("17 Nov"))
        assertNull(TasksFormat.dueText("not a date", zone, now, Locale.US))
    }

    @Test
    fun bell_splits_today_and_filters_from_kind_and_read() {
        val zone = ZoneId.of("UTC")
        val now = Instant.parse("2026-11-15T08:00:00Z")
        assertTrue(TasksFormat.isToday("2026-11-15T01:00:00Z", zone, now))
        assertFalse(TasksFormat.isToday("2026-11-14T23:00:00Z", zone, now))
        assertFalse(TasksFormat.isToday("not a date", zone, now))
        assertEquals("14 Nov", TasksFormat.whenText("2026-11-14T23:00:00Z", zone, now, Locale.US))
        val waiting = AlertRow("1", "patient_waiting", read = false, at = "", appointmentId = "a")
        val booking = AlertRow("2", "booking_requested", read = true, at = "", appointmentId = "b")
        assertTrue(BellFilter.Queue.keeps(waiting))
        assertFalse(BellFilter.Queue.keeps(booking))
        assertTrue(BellFilter.Bookings.keeps(booking))
        assertFalse(BellFilter.Unread.keeps(booking))
        assertEquals(SkTone.Warning, TasksFormat.tintFor("collect_payment"))
        assertEquals(SkTone.Brand, TasksFormat.tintFor("patient_waiting"))
        assertEquals("wallet", TasksFormat.iconFor("collect_payment"))
    }

    @Test
    fun booking_url_trims_the_origin() {
        assertEquals("https://x.example.com/book", bookingUrl("https://x.example.com/"))
        assertNull(bookingUrl(""))
    }
}
