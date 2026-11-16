package com.aarogyam.staff.android.ui.tasks

import com.aarogyam.staff.notifications.NotificationKinds
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Plain helpers for My tasks and the bell; no UI, so a JVM test reaches them (iOS `TasksV10`). */
object TasksFormat {
    /** The time part of "Due 4:30 pm", with the day when it is not today; null when [iso] is not a date. */
    fun dueText(
        iso: String,
        zone: ZoneId,
        now: Instant,
        locale: Locale,
    ): String? {
        val at = runCatching { Instant.parse(iso) }.getOrNull() ?: return null
        val local = at.atZone(zone)
        val time = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)
        return if (local.toLocalDate() == now.atZone(zone).toLocalDate()) {
            time.format(local)
        } else {
            DateTimeFormatter.ofPattern("d MMM", locale).format(local) + " " + time.format(local)
        }
    }

    /** Whole units from the quantity field; null for blank, zero or anything else. */
    fun quantity(text: String): Long? = text.trim().toLongOrNull()?.takeIf { it > 0 }

    /** The art icon for a notification kind; the shared set's names map to the mockup icons, anything else is the message bubble. */
    fun iconFor(kind: String): String =
        when (NotificationKinds.of(kind).icon) {
            "clock" -> "queue"
            "bell" -> "bell"
            "check" -> "check"
            "alert" -> "help"
            "calendar" -> "cal"
            "box" -> "box"
            else -> "msg"
        }
}
