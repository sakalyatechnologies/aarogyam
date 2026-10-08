package com.aarogyam.patient.android.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.aarogyam.patient.ClinicTime
import com.aarogyam.patient.ScreenError
import com.aarogyam.patient.VisitStatus
import com.aarogyam.patient.android.R
import com.aarogyam.patient.clinics.LinkError
import com.aarogyam.patient.signin.SignInError
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.color
import java.text.NumberFormat
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** A centred progress indicator, announced as loading. */
@Composable
fun LoadingIndicator() {
    val label = stringResource(R.string.loading)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(
            Modifier.semantics { contentDescription = label },
            color = SkTheme.colors.primary.color,
        )
    }
}

/** A failed load, with a retry. */
@Composable
fun ErrorState(
    error: ScreenError,
    onRetry: () -> Unit,
) = SkEmptyState(
    stringResource(error.message()),
    "",
    actionLabel = stringResource(R.string.try_again),
    onAction = onRetry,
)

@StringRes
fun ScreenError.message(): Int =
    when (this) {
        ScreenError.Offline -> R.string.error_offline
        ScreenError.Network, ScreenError.Server -> R.string.error_network
        ScreenError.SignedOut -> R.string.error_signed_out
        ScreenError.UpgradeRequired -> R.string.error_upgrade
        ScreenError.NotConfigured -> R.string.error_not_configured
        else -> R.string.error_unknown
    }

@StringRes
fun SignInError.message(): Int =
    when (this) {
        SignInError.InvalidEmail -> R.string.error_invalid_email
        SignInError.InvalidCode -> R.string.error_invalid_code
        SignInError.EmailNotAccepted -> R.string.error_email_not_accepted
        SignInError.CodeRejected -> R.string.error_code_rejected
        SignInError.TooManyAttempts -> R.string.error_too_many
        SignInError.Offline -> R.string.error_offline
        SignInError.Network -> R.string.error_network
        SignInError.Unknown -> R.string.error_unknown
    }

@StringRes
fun LinkError.message(): Int =
    when (this) {
        LinkError.InvalidCode -> R.string.link_invalid_code
        LinkError.CodeNotFound -> R.string.link_not_found
        LinkError.OtherRecord -> R.string.link_other_record
        LinkError.RecordTaken -> R.string.link_taken
        LinkError.NoClinic -> R.string.link_no_clinic
        LinkError.TooManyAttempts -> R.string.error_too_many
        LinkError.Offline -> R.string.error_offline
        LinkError.Failed -> R.string.error_unknown
    }

/** The status chip for an appointment. */
@Composable
fun StatusChip(status: VisitStatus) {
    val (text, tone) =
        when (status) {
            VisitStatus.Requested -> R.string.status_requested to SkTone.Warning
            VisitStatus.Booked -> R.string.status_booked to SkTone.Brand
            VisitStatus.Confirmed -> R.string.status_confirmed to SkTone.Success
            VisitStatus.AtClinic -> R.string.status_at_clinic to SkTone.Brand
            VisitStatus.Done -> R.string.status_done to SkTone.Neutral
            VisitStatus.Cancelled -> R.string.status_cancelled to SkTone.Neutral
            VisitStatus.Missed, VisitStatus.Unknown -> R.string.status_missed to SkTone.Neutral
        }
    SkChip(stringResource(text), tone = tone)
}

/** Rupees from paise, such as `₹1,250`. */
fun rupees(paise: Long): String {
    val format = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("en-IN"))
    format.maximumFractionDigits = if (paise % PAISE_PER_RUPEE == 0L) 0 else 2
    return format.format(paise / PAISE_PER_RUPEE.toDouble())
}

/** `Thu, 8 Oct · 10:30 am`, in the clinic's own time. */
fun ClinicTime.dateTime(): String = "${date()} · ${time()}"

/** `Thu, 8 Oct 2026`. */
fun ClinicTime.date(): String =
    java.time.LocalDate
        .parse(date.toString())
        .format(DAY)

/** `10:30 am`. */
fun ClinicTime.time(): String =
    java.time.LocalTime
        .of(time.hour, time.minute)
        .format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT))

private val DAY = DateTimeFormatter.ofPattern("EEE, d MMM yyyy", Locale.forLanguageTag("en-IN"))
private const val PAISE_PER_RUPEE = 100L
