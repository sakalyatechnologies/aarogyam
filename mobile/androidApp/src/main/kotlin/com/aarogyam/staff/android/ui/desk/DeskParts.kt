package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.desk.PatientState
import com.aarogyam.staff.patients.Sex
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.delay
import kotlin.time.Clock
import kotlin.time.Instant

/** Who a payment sheet is for. The name is on screen only, never logged. */
data class DeskPayTarget(
    val patientId: String,
    val name: String,
    /** The `collect_payment` notification behind a To-pay card, when the desk knows it. */
    val notificationId: String? = null,
    /** The bill to collect, when the caller knows it; null lets the sheet pick. */
    val invoiceId: String? = null,
)

/** A person on the number a new relative can be linked to. */
data class DeskFamilyAnchor(
    val id: String,
    val name: String,
)

/** The clock, ticking each second while the screen is started. */
@Composable
fun rememberNow(): State<Instant> {
    val now = remember { mutableStateOf(Clock.System.now()) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                now.value = Clock.System.now()
                delay(TICK_MILLIS)
            }
        }
    }
    return now
}

private const val TICK_MILLIS = 1_000L

@Composable
fun PatientState.title(): String =
    stringResource(
        when (this) {
            PatientState.Waiting -> R.string.dk_d9_state_waiting
            PatientState.Called -> R.string.dk_d9_state_called
            PatientState.InConsult -> R.string.dk_d9_state_in_consult
            PatientState.InChair -> R.string.dk_d9_state_in_chair
            PatientState.ReadyToBill -> R.string.dk_d9_state_ready_to_bill
            PatientState.Done -> R.string.dk_d9_state_done
            PatientState.Left -> R.string.dk_d9_state_left
        },
    )

/** `Dr Patil`; a name that already starts with Dr or Dr. is left as it is. */
@Composable
fun doctorLabel(name: String): String =
    if (DeskDoctors.hasTitle(name)) name.trim() else stringResource(R.string.dk_dx_dr, name.trim())

/** `SC-1042 · Age 34 · Female`: the clinic number, age and sex that are known. */
@Composable
fun patientLine(
    number: String,
    ageYears: Int?,
    sex: Sex,
): String {
    val age = ageYears?.let { stringResource(R.string.age_years, it) }
    val sexText = sex.label()?.let { stringResource(it) }
    return listOfNotNull(number.takeIf { it.isNotBlank() }, age, sexText).joinToString(" · ")
}

/** A tinted notice line (offline, a failed refresh). */
@Composable
fun DeskNotice(text: String) {
    Text(
        text,
        style = SkTypography.footnote,
        color = SkTheme.colors.dangerText.color,
        modifier =
            Modifier
                .fillMaxWidth()
                .background(SkTheme.colors.dangerSoft.color, RoundedCornerShape(Spacing.SM.dp))
                .padding(horizontal = Spacing.M.dp, vertical = Spacing.S.dp),
    )
}

@Composable
fun DeskErrorText(text: String) = Text(text, style = SkTypography.footnote, color = SkTheme.colors.dangerText.color)

@Composable
fun DeskMutedText(text: String) = Text(text, style = SkTypography.footnote, color = SkTheme.colors.textMuted.color)

@Composable
fun DeskLabel(text: String) = Text(text, style = SkTypography.label, color = SkTheme.colors.textMuted.color)

/** Buttons and chips that wrap onto the next line. */
@Composable
fun DeskWrap(content: @Composable () -> Unit) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.S.dp),
    ) { content() }
}
