package com.aarogyam.staff.android.ui

import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.live.LiveLogic
import com.aarogyam.staff.android.ui.tasks.TasksFormat
import com.aarogyam.staff.android.ui.today.TodayLogic
import com.aarogyam.staff.android.ui.today.bookingUrl
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
    fun booking_url_trims_the_origin() {
        assertEquals("https://x.example.com/book", bookingUrl("https://x.example.com/"))
        assertNull(bookingUrl(""))
    }
}
