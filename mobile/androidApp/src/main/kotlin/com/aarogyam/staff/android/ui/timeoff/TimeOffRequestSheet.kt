package com.aarogyam.staff.android.ui.timeoff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.clinical.ChoiceChips
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.timeoff.TimeOffHolder
import com.aarogyam.staff.timeoff.TimeOffKind
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

private const val REASON_MAX = 200

/** "Request time off": a kind, the first and last day, and an optional reason. Closes once the server accepts it. */
@Composable
internal fun TimeOffRequestSheet(
    holder: TimeOffHolder,
    today: String,
    onDismiss: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    var kind by remember { mutableStateOf(TimeOffKind.Vacation) }
    var first by remember { mutableStateOf(today) }
    var last by remember { mutableStateOf(today) }
    var reason by remember { mutableStateOf("") }
    var picking by remember { mutableStateOf<Boolean?>(null) }
    val sentAtOpen = remember { state.sent }
    LaunchedEffect(state.sent) { if (state.sent > sentAtOpen) onDismiss() }
    val locale = LocalConfiguration.current.locales[0]
    SkModalSheet(stringResource(R.string.timeoff_request), onDismiss) {
        Text(
            stringResource(R.string.timeoff_kind),
            style = SkTypography.label,
            color = SkTheme.palette.onSurfaceVariant.color,
        )
        ChoiceChips(TimeOffKind.entries, { it == kind }, { stringResource(TimeOffFormat.kindLabel(it)) }) { kind = it }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
            DayButton(
                stringResource(R.string.timeoff_first_day),
                TimeOffFormat.day(first, locale),
                Modifier.weight(1f),
            ) {
                picking =
                    true
            }
            DayButton(stringResource(R.string.timeoff_last_day), TimeOffFormat.day(last, locale), Modifier.weight(1f)) {
                picking =
                    false
            }
        }
        SkField(
            stringResource(R.string.timeoff_reason),
            reason,
            { reason = it.take(REASON_MAX) },
            Modifier.fillMaxWidth(),
        )
        state.error?.let {
            Text(stringResource(it.message()), style = SkTypography.footnote, color = SkTheme.palette.error.color)
        }
        SkPillButton(
            stringResource(R.string.timeoff_send),
            { holder.request(kind, first, last, reason.ifBlank { null }) },
            wide = true,
            enabled = !state.sending,
            loading = state.sending,
        )
    }
    when (picking) {
        true -> {
            PickDialog(first, { picking = null }) {
                first = it
                if (last < it) last = it
            }
        }

        false -> {
            PickDialog(last, { picking = null }) { last = if (it < first) first else it }
        }

        null -> {}
    }
}

@Composable
private fun DayButton(
    label: String,
    value: String,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    Column(modifier) {
        Text(label, style = SkTypography.label, color = SkTheme.palette.onSurfaceVariant.color)
        SkPillButton(value, onClick, Modifier.padding(top = 4.dp).fillMaxWidth(), variant = SkPillVariant.Tonal)
    }
}

@Composable
private fun PickDialog(
    initial: String,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    val picker = rememberDatePickerState(initialSelectedDateMillis = TimeOffFormat.millis(initial))
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                picker.selectedDateMillis?.let { onPick(TimeOffFormat.iso(it)) }
                onDismiss()
            }) { Text(stringResource(R.string.timeoff_done)) }
        },
    ) { DatePicker(picker) }
}
