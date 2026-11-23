package com.aarogyam.staff.android.ui.timeoff

import androidx.annotation.StringRes
import com.aarogyam.staff.android.R
import com.aarogyam.staff.timeoff.TimeOffKind
import com.aarogyam.staff.timeoff.TimeOffStatus
import com.sakalya.mobile.designcompose.SkTone
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

internal object TimeOffFormat {
    private const val MILLIS_PER_DAY = 86_400_000L

    /** `12 Oct 2026` for `2026-10-12`, in [locale]; the text itself when it is not a date. */
    fun day(
        iso: String,
        locale: Locale,
    ): String =
        runCatching {
            LocalDate.parse(iso).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
        }.getOrDefault(iso)

    /** The date picker's UTC midnight for `YYYY-MM-DD`. */
    fun millis(iso: String): Long = LocalDate.parse(iso).toEpochDay() * MILLIS_PER_DAY

    fun iso(millis: Long): String = LocalDate.ofEpochDay(Math.floorDiv(millis, MILLIS_PER_DAY)).toString()

    @StringRes
    fun kindLabel(kind: TimeOffKind?): Int =
        when (kind) {
            TimeOffKind.Vacation -> R.string.timeoff_kind_vacation
            TimeOffKind.Sick -> R.string.timeoff_kind_sick
            TimeOffKind.Personal -> R.string.timeoff_kind_personal
            TimeOffKind.Other, null -> R.string.timeoff_kind_other
        }

    @StringRes
    fun statusLabel(status: TimeOffStatus): Int =
        when (status) {
            TimeOffStatus.Pending -> R.string.timeoff_status_pending
            TimeOffStatus.Approved -> R.string.timeoff_status_approved
            TimeOffStatus.Declined -> R.string.timeoff_status_declined
            TimeOffStatus.Cancelled -> R.string.timeoff_status_cancelled
        }

    fun statusTone(status: TimeOffStatus): SkTone =
        when (status) {
            TimeOffStatus.Pending -> SkTone.Warning
            TimeOffStatus.Approved -> SkTone.Success
            TimeOffStatus.Declined -> SkTone.Danger
            TimeOffStatus.Cancelled -> SkTone.Neutral
        }
}
