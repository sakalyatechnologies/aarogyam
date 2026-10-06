package com.aarogyam.staff.android.ui

import androidx.annotation.StringRes
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.android.R
import com.aarogyam.staff.signin.SignInError
import com.aarogyam.staff.today.VisitStatus
import com.sakalya.mobile.designcompose.SkTone
import kotlinx.datetime.LocalTime
import kotlinx.datetime.toJavaLocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@StringRes
fun ScreenError.message(): Int =
    when (this) {
        ScreenError.Offline -> R.string.error_offline
        ScreenError.Network -> R.string.error_network
        ScreenError.SignedOut -> R.string.error_signed_out
        ScreenError.NotAllowed -> R.string.error_not_allowed
        ScreenError.NotFound -> R.string.error_not_found
        ScreenError.UpgradeRequired -> R.string.error_upgrade
        ScreenError.Server -> R.string.error_server
        ScreenError.NotConfigured -> R.string.error_not_configured
        ScreenError.Unknown -> R.string.error_unknown
    }

@StringRes
fun SignInError.message(): Int =
    when (this) {
        SignInError.InvalidEmail -> R.string.sign_in_error_invalid_email
        SignInError.InvalidCode -> R.string.sign_in_error_invalid_code
        SignInError.EmailNotAccepted -> R.string.sign_in_error_email_not_accepted
        SignInError.CodeRejected -> R.string.sign_in_error_code_rejected
        SignInError.TooManyAttempts -> R.string.sign_in_error_too_many
        SignInError.Offline -> R.string.error_offline
        SignInError.Network -> R.string.error_network
        SignInError.Unknown -> R.string.error_unknown
    }

@StringRes
fun VisitStatus.label(): Int =
    when (this) {
        VisitStatus.Booked -> R.string.status_booked
        VisitStatus.Confirmed -> R.string.status_confirmed
        VisitStatus.Arrived -> R.string.status_waiting
        VisitStatus.InChair -> R.string.status_in_chair
        VisitStatus.Completed -> R.string.status_done
        VisitStatus.Cancelled -> R.string.status_cancelled
        VisitStatus.NoShow -> R.string.status_no_show
        VisitStatus.Unknown -> R.string.status_unknown
    }

fun VisitStatus.tone(): SkTone =
    when (this) {
        VisitStatus.Completed -> SkTone.Success
        VisitStatus.Arrived -> SkTone.Warning
        VisitStatus.InChair -> SkTone.Brand
        VisitStatus.Confirmed -> SkTone.Info
        VisitStatus.NoShow, VisitStatus.Cancelled -> SkTone.Danger
        VisitStatus.Booked, VisitStatus.Unknown -> SkTone.Neutral
    }

private val timeFormat: DateTimeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)

/** A clinic-local time in the phone's locale format (`9:00 am`). */
fun LocalTime.display(): String = toJavaLocalTime().format(timeFormat)
