package com.aarogyam.staff.android.ui.clinical

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.expenses.PayMethod
import com.aarogyam.staff.expenses.RecurEvery
import com.aarogyam.staff.expenses.RecurringExpensesStateHolder
import com.aarogyam.staff.expenses.RecurringProblem
import com.aarogyam.staff.expenses.SpendCategory
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The Add recurring sheet: the amount, category and method, monthly or weekly with its day, a note and Save. */
@Composable
fun RecurringSheet(
    holder: RecurringExpensesStateHolder,
    onDismiss: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val draft = state.draft
    var tried by remember { mutableStateOf(false) }
    val colors = SkTheme.colors
    SkBottomSheet(title = stringResource(R.string.cn_c_recur_add), onDismiss = onDismiss) {
        Column(
            Modifier
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.L.dp, vertical = Spacing.M.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        ) {
            if (draft.saved) {
                Text(
                    stringResource(R.string.cn_c_recur_saved_title),
                    style = SkTypography.headline,
                    color = colors.text.color,
                )
                Text(
                    stringResource(R.string.cn_c_recur_saved_message),
                    style = SkTypography.bodyText,
                    color = colors.textMuted.color,
                )
                SkButton(stringResource(R.string.done), onDismiss, Modifier.fillMaxWidth())
            } else {
                val amountText = draft.amountPaise.rupees()
                val amountLabel = stringResource(R.string.cn_c_expenses_amount_a11y, amountText)
                Text(
                    amountText,
                    style = SkTypography.largeTitle,
                    color = colors.text.color,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = amountLabel },
                )
                val problem = if (tried) holder.problem(draft) else null
                problem?.let {
                    Text(
                        stringResource(recurringProblemText(it)),
                        style = SkTypography.footnote,
                        color = colors.dangerText.color,
                    )
                }
                ChoiceChips(
                    SpendCategory.entries,
                    { it == draft.category },
                    { stringResource(categoryLabel(it)) },
                    holder::setCategory,
                )
                ChoiceChips(
                    PayMethod.entries,
                    { it == draft.method },
                    { stringResource(methodLabel(it)) },
                    holder::setMethod,
                )
                Keypad(draft.rupees, holder::setRupees)
                ChoiceChips(
                    RecurEvery.entries,
                    { it == draft.every },
                    { stringResource(everyLabel(it)) },
                    holder::setEvery,
                )
                when (draft.every) {
                    RecurEvery.Monthly -> {
                        SectionLabel(stringResource(R.string.cn_c_recur_day_label))
                        ChoiceChips(
                            (1..LAST_SAFE_DAY).toList(),
                            { it == draft.dayOfMonth },
                            { it.toString() },
                            holder::setDayOfMonth,
                        )
                    }

                    RecurEvery.Weekly -> {
                        SectionLabel(stringResource(R.string.cn_c_recur_weekday_label))
                        ChoiceChips(
                            (1..DAYS_IN_WEEK).toList(),
                            { it == draft.weekday },
                            { weekdayName(it) },
                            holder::setWeekday,
                        )
                    }
                }
                SkTextField(
                    draft.note,
                    holder::setNote,
                    stringResource(R.string.cn_c_expenses_note),
                    placeholder = stringResource(R.string.cn_c_recur_note_prompt),
                )
                draft.error?.let {
                    Text(stringResource(it.message()), style = SkTypography.footnote, color = colors.dangerText.color)
                }
            }
        }
        if (!draft.saved) {
            SkButton(
                stringResource(R.string.cn_c_recur_save),
                {
                    tried = true
                    holder.save()
                },
                Modifier.fillMaxWidth().padding(horizontal = Spacing.L.dp, vertical = Spacing.SM.dp),
                enabled = !draft.saving,
            )
        }
    }
}

private const val LAST_SAFE_DAY = 28
private const val DAYS_IN_WEEK = 7

private fun everyLabel(every: RecurEvery): Int =
    when (every) {
        RecurEvery.Monthly -> R.string.cn_c_recur_every_monthly
        RecurEvery.Weekly -> R.string.cn_c_recur_every_weekly
    }

private fun recurringProblemText(problem: RecurringProblem): Int =
    when (problem) {
        RecurringProblem.NoAmount -> R.string.cn_c_expenses_problem_amount
        RecurringProblem.TooLarge -> R.string.cn_c_expenses_problem_large
        RecurringProblem.NoDayOfMonth -> R.string.cn_c_recur_problem_day
        RecurringProblem.NoWeekday -> R.string.cn_c_recur_problem_weekday
        RecurringProblem.StartOutOfRange -> R.string.cn_c_recur_problem_start
        RecurringProblem.NoteTooLong -> R.string.cn_c_expenses_problem_note
    }
