package com.aarogyam.staff.android.ui.clinical

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.expenses.RecurEvery
import com.aarogyam.staff.expenses.RecurStatus
import com.aarogyam.staff.expenses.RecurringExpensesState
import com.aarogyam.staff.expenses.RecurringRow
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import java.time.DayOfWeek
import java.time.format.TextStyle

/** What the Recurring section asks of its holder. */
class RecurringActions(
    val onAdd: () -> Unit,
    val onPause: (String) -> Unit,
    val onResume: (String) -> Unit,
    /** Asks first; see [StopRecurringDialog]. */
    val onStop: (String) -> Unit,
    val onRetry: () -> Unit,
)

/** The Recurring section of the Expenses page: a header with Add, then one card per recurring expense. */
fun LazyListScope.recurringSection(
    state: RecurringExpensesState,
    actions: RecurringActions,
) {
    if (!state.allowed) return
    item(key = "recur-header") {
        Row(
            Modifier.fillMaxWidth().padding(top = Spacing.SM.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SectionLabel(stringResource(R.string.cn_c_recur_title), Modifier.weight(1f))
            if (state.canChange) {
                TextButton(onClick = actions.onAdd) { Text(stringResource(R.string.cn_c_recur_add)) }
            }
        }
    }
    val error = state.error
    when {
        error != null -> {
            item(key = "recur-error") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        stringResource(error.message()),
                        style = SkTypography.footnote,
                        color = SkTheme.colors.dangerText.color,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = actions.onRetry) { Text(stringResource(R.string.try_again)) }
                }
            }
        }

        !state.loading && state.rows.isEmpty() -> {
            item(key = "recur-empty") {
                Text(
                    stringResource(R.string.cn_c_recur_empty),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.textMuted.color,
                )
            }
        }
    }
    items(state.rows, key = { "recur-" + it.id }) { row ->
        RecurringItem(row, state.canChange, state.busy, actions)
    }
}

@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(text.uppercase(), style = SkTypography.overline, color = SkTheme.colors.textMuted.color, modifier = modifier)
}

/** One recurring expense: category, cadence and next due day, its status, and the actions its status allows. */
@Composable
private fun RecurringItem(
    row: RecurringRow,
    canChange: Boolean,
    busy: String?,
    actions: RecurringActions,
) {
    val colors = SkTheme.colors
    val title = row.categoryName.ifEmpty { stringResource(categoryLabel(row.category)) }
    val live = row.status == RecurStatus.Active || row.status == RecurStatus.Paused
    val next = if (live) stringResource(R.string.cn_c_recur_next, ClinicalFormat.date(row.nextDue.toString())) else null
    Column(Modifier.background(colors.card.color, RoundedCornerShape(16.dp))) {
        SkListRow(
            title = title,
            subtitle = ClinicalFormat.joinDot(listOf(cadenceText(row), next, row.note)),
            trailing = {
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(row.amountPaise.rupees(), style = SkTypography.bodyStrong, color = colors.text.color)
                    SkChip(stringResource(statusLabel(row.status)), tone = statusTone(row.status))
                }
            },
        )
        if (canChange && row.canStop) {
            Row(
                Modifier.padding(start = Spacing.ML.dp, end = Spacing.ML.dp, bottom = Spacing.SM.dp),
                horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
            ) {
                val idle = busy == null
                if (row.canPause) {
                    SkButton(stringResource(R.string.cn_c_recur_pause), {
                        actions.onPause(row.id)
                    }, Modifier.weight(1f), SkButtonVariant.Secondary, idle)
                }
                if (row.canResume) {
                    SkButton(stringResource(R.string.cn_c_recur_resume), {
                        actions.onResume(row.id)
                    }, Modifier.weight(1f), SkButtonVariant.Secondary, idle)
                }
                SkButton(stringResource(R.string.cn_c_recur_stop), {
                    actions.onStop(row.id)
                }, Modifier.weight(1f), SkButtonVariant.Danger, idle)
            }
        }
    }
}

/** "Monthly on day 5" or "Weekly on Mon". */
@Composable
fun cadenceText(row: RecurringRow): String =
    when (row.every) {
        RecurEvery.Monthly -> stringResource(R.string.cn_c_recur_monthly_on, row.dayOfMonth ?: 1)
        RecurEvery.Weekly -> stringResource(R.string.cn_c_recur_weekly_on, weekdayName(row.weekday ?: 1))
    }

/** The short name of ISO weekday [day] (1 is Monday) in the app's language. */
@Composable
fun weekdayName(day: Int): String =
    DayOfWeek.of(day.coerceIn(1, 7)).getDisplayName(TextStyle.SHORT, LocalConfiguration.current.locales[0])

private fun statusLabel(status: RecurStatus): Int =
    when (status) {
        RecurStatus.Active -> R.string.cn_c_recur_status_active
        RecurStatus.Paused -> R.string.cn_c_recur_status_paused
        RecurStatus.Stopped -> R.string.cn_c_recur_status_stopped
        RecurStatus.Ended -> R.string.cn_c_recur_status_ended
    }

private fun statusTone(status: RecurStatus): SkTone =
    when (status) {
        RecurStatus.Active -> SkTone.Success
        RecurStatus.Paused -> SkTone.Warning
        RecurStatus.Stopped, RecurStatus.Ended -> SkTone.Neutral
    }

/** Stopping is final, so it asks first. */
@Composable
fun StopRecurringDialog(
    onDismiss: () -> Unit,
    onStop: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.cn_c_recur_stop_title)) },
        text = { Text(stringResource(R.string.cn_c_recur_stop_message)) },
        confirmButton = {
            TextButton(onClick = {
                onDismiss()
                onStop()
            }) { Text(stringResource(R.string.cn_c_recur_stop), color = SkTheme.colors.dangerText.color) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cn_c_expenses_cancel)) } },
    )
}
