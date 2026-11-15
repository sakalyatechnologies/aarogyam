package com.aarogyam.staff.android.ui.visit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** The optional follow-up and fee entered at close. */
internal class CloseForm {
    var followUpOn by mutableStateOf(false)
    var followUpDate: LocalDate by mutableStateOf(LocalDate.now().plusDays(DEFAULT_FOLLOW_UP_DAYS))
    var feeText by mutableStateOf("")

    private companion object {
        const val DEFAULT_FOLLOW_UP_DAYS = 7L
    }
}

/** Close visit: optional follow-up and fee, then the button; with an unsigned prescription it turns into a confirm card. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun VisitCloseArea(
    form: CloseForm,
    confirm: Boolean,
    canBill: Boolean,
    canFollowUp: Boolean,
    closing: Boolean,
    error: String?,
    onClose: () -> Unit,
    onCloseAnyway: () -> Unit,
    onSignNow: () -> Unit,
) {
    val colors = SkTheme.colors
    var picking by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp)) {
        SkCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.M.dp)) {
                SectionTitle(stringResource(R.string.vv_v9v_close_after))
                if (canFollowUp) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            stringResource(R.string.vv_v9v_close_follow_up),
                            style = SkTypography.bodyText,
                            color = colors.text.color,
                        )
                        Switch(form.followUpOn, { form.followUpOn = it })
                    }
                    if (form.followUpOn) {
                        SkButton(
                            "${stringResource(
                                R.string.vv_v9v_close_follow_up_date,
                            )}: ${form.followUpDate.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))}",
                            onClick = { picking = true },
                            variant = SkButtonVariant.Secondary,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                if (canBill) {
                    SkTextField(
                        form.feeText,
                        { form.feeText = it },
                        stringResource(R.string.vv_v9v_close_fee),
                        placeholder = stringResource(R.string.vv_v9v_close_fee_hint),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                }
            }
        }
        if (confirm) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(
                        RoundedCornerShape(Spacing.XL.dp),
                    ).background(colors.warningSoft.color)
                    .padding(Spacing.ML.dp),
                verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
            ) {
                Text(
                    stringResource(R.string.vv_v9v_close_confirm_title),
                    style = SkTypography.headline,
                    color = colors.warningText.color,
                )
                Text(
                    stringResource(R.string.vv_v9v_close_confirm_message),
                    style = SkTypography.footnote,
                    color = colors.warningText.color,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                    SkButton(
                        stringResource(R.string.vv_v9v_close_anyway),
                        onClick = onCloseAnyway,
                        variant = SkButtonVariant.Secondary,
                        modifier = Modifier.weight(1f),
                    )
                    SkButton(
                        stringResource(R.string.vv_v9v_close_sign_now),
                        onClick = onSignNow,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        } else {
            SkButton(
                stringResource(R.string.vv_c_visit_close),
                onClick = onClose,
                enabled = !closing,
                modifier = Modifier.fillMaxWidth(),
            )
            Muted(stringResource(R.string.vv_v9v_close_note), Modifier.fillMaxWidth())
        }
        error?.let { ErrorLine(it) }
    }
    if (picking) {
        val today = LocalDate.now()
        val state =
            rememberDatePickerState(
                initialSelectedDateMillis =
                    form.followUpDate
                        .atStartOfDay(ZoneOffset.UTC)
                        .toInstant()
                        .toEpochMilli(),
                selectableDates =
                    object : SelectableDates {
                        override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                            !Instant
                                .ofEpochMilli(utcTimeMillis)
                                .atZone(ZoneOffset.UTC)
                                .toLocalDate()
                                .isBefore(today)
                    },
            )
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let {
                        form.followUpDate =
                            Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()
                    }
                    picking = false
                }) { Text(stringResource(R.string.done)) }
            },
        ) { DatePicker(state) }
    }
}

/** What a closed visit shows: taken when Close is tapped, because the lists it came from are then gone. */
internal data class VisitSnapshot(
    val procedures: List<String> = emptyList(),
    val notes: Int = 0,
    val rxNumber: String? = null,
    val medicines: Int = 0,
    val followUp: LocalDate? = null,
    val feePaise: Long? = null,
)

/** After the visit closed: what was done, the bill and the way back to the patient. */
@Composable
internal fun VisitSummary(
    snapshot: VisitSnapshot,
    minutes: Long,
    firstName: String,
    share: @Composable () -> Unit,
    onBack: () -> Unit,
) {
    val colors = SkTheme.colors
    val none = stringResource(R.string.vv_v9v_sum_none)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp)) {
        SkCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.M.dp)) {
                SummaryRow(
                    stringResource(R.string.vv_v9v_sum_treatment),
                    snapshot.procedures.joinToString(", ").ifEmpty { none },
                )
                SummaryRow(
                    stringResource(R.string.vv_v9v_sum_notes),
                    if (snapshot.notes == 0) none else stringResource(R.string.vv_v9v_sum_notes_value, snapshot.notes),
                )
                SummaryRow(
                    stringResource(R.string.vv_v9v_sum_rx),
                    if (snapshot.medicines ==
                        0
                    ) {
                        none
                    } else {
                        stringResource(
                            R.string.vv_v9v_sum_rx_value,
                            snapshot.rxNumber.orEmpty(),
                            snapshot.medicines,
                        )
                    },
                )
                snapshot.followUp?.let {
                    SummaryRow(
                        stringResource(R.string.vv_v9v_sum_follow_up),
                        it.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)),
                    )
                }
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(
                            stringResource(R.string.vv_v9v_sum_bill),
                            style = SkTypography.headline,
                            color = colors.text.color,
                        )
                        Muted(stringResource(R.string.vv_v9v_sum_time, minutes))
                    }
                    Text(
                        snapshot.feePaise?.let { VisitMoney.rupees(it) }
                            ?: stringResource(R.string.vv_v9v_sum_bill_desk),
                        style = if (snapshot.feePaise == null) SkTypography.callout else SkTypography.title,
                        color = colors.text.color,
                        textAlign = TextAlign.End,
                    )
                }
            }
        }
        share()
        SkButton(
            stringResource(R.string.vv_v9v_sum_back, firstName),
            onClick = onBack,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun SummaryRow(
    title: String,
    value: String,
) {
    Column(Modifier.fillMaxWidth()) {
        Text(title, style = SkTypography.bodyStrong, color = SkTheme.colors.text.color)
        Muted(value)
    }
}
