package com.aarogyam.staff.android.ui.tasks

import com.aarogyam.staff.notifications.NotificationCategory
import com.aarogyam.staff.notifications.NotificationKinds
import com.aarogyam.staff.team.AlertRow
import com.sakalya.mobile.designcompose.SkTone
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

    /**
     * The art icon for a notification kind: money and lab kinds get their own, the shared set's names map to the
     * mockup icons, anything else is the message bubble.
     */
    fun iconFor(kind: String): String {
        val info = NotificationKinds.of(kind)
        if (kind == "collect_payment" || info.category == NotificationCategory.Payment) return "wallet"
        if (info.category == NotificationCategory.Lab) return "flask"
        return when (info.icon) {
            "clock" -> "queue"
            "bell" -> "bell"
            "check" -> "check"
            "alert" -> "help"
            "calendar" -> "cal"
            "box" -> "box"
            else -> "msg"
        }
    }

    /** The tile tint of a kind, so queue, money and booking rows are told apart without reading (Clear Glass). */
    fun tintFor(kind: String): SkTone {
        if (kind == "collect_payment") return SkTone.Warning
        return when (NotificationKinds.of(kind).category) {
            NotificationCategory.Queue -> SkTone.Brand
            NotificationCategory.Payment -> SkTone.Warning
            NotificationCategory.Booking, NotificationCategory.TimeOff -> SkTone.Info
            NotificationCategory.Lab -> SkTone.Danger
            NotificationCategory.Recall, NotificationCategory.Patient -> SkTone.Success
            else -> SkTone.Neutral
        }
    }

    /** True when [iso] falls on today's date in [zone]; a row whose time does not parse counts as earlier. */
    fun isToday(
        iso: String,
        zone: ZoneId,
        now: Instant,
    ): Boolean {
        val at = runCatching { Instant.parse(iso) }.getOrNull() ?: return false
        return at.atZone(zone).toLocalDate() == now.atZone(zone).toLocalDate()
    }

    /** The bell's time column: the clock time today, the day ("12 Oct") before; null when [iso] is not a date. */
    fun whenText(
        iso: String,
        zone: ZoneId,
        now: Instant,
        locale: Locale,
    ): String? {
        val at = runCatching { Instant.parse(iso) }.getOrNull() ?: return null
        val local = at.atZone(zone)
        return if (local.toLocalDate() == now.atZone(zone).toLocalDate()) {
            DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(local)
        } else {
            DateTimeFormatter.ofPattern("d MMM", locale).format(local)
        }
    }
}

/** The bell's segmented filter, read from data every row already has (kind and read). */
enum class BellFilter {
    All,
    Unread,
    Queue,
    Bookings,
    ;

    fun keeps(row: AlertRow): Boolean =
        when (this) {
            All -> true
            Unread -> !row.read
            Queue -> NotificationKinds.of(row.kind).category == NotificationCategory.Queue
            Bookings -> NotificationKinds.of(row.kind).category == NotificationCategory.Booking
        }
}
