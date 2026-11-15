package com.aarogyam.staff.android.ui.clinical

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.expenses.ExpenseProblem
import com.aarogyam.staff.expenses.ExpensesStateHolder
import com.aarogyam.staff.expenses.PayMethod
import com.aarogyam.staff.expenses.SpendCategory
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The Add expense sheet: a big amount, category and method chips, the keypad, a note and Save. Bill photo waits for server support. */
@Composable
fun ExpenseSheet(
    holder: ExpensesStateHolder,
    onDismiss: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val draft = state.draft
    var tried by remember { mutableStateOf(false) }
    val colors = SkTheme.colors
    SkBottomSheet(title = stringResource(R.string.cn_c_expenses_add), onDismiss = onDismiss) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = Spacing.L.dp, vertical = Spacing.M.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        ) {
            if (draft.saved) {
                Text(
                    stringResource(R.string.cn_c_expenses_saved_title),
                    style = SkTypography.headline,
                    color = colors.text.color,
                )
                Text(
                    stringResource(R.string.cn_c_expenses_saved_message),
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
                        stringResource(problemText(it)),
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
                SkTextField(
                    draft.note,
                    holder::setNote,
                    stringResource(R.string.cn_c_expenses_note),
                    placeholder = stringResource(R.string.cn_c_expenses_note_prompt),
                )
                draft.error?.let {
                    Text(
                        stringResource(it.message()),
                        style = SkTypography.footnote,
                        color = colors.dangerText.color,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                    SkButton(stringResource(R.string.cn_c_expenses_photo), {
                    }, Modifier.weight(1f), SkButtonVariant.Secondary, enabled = false)
                    SkButton(stringResource(R.string.cn_c_expenses_save), {
                        tried = true
                        holder.save()
                    }, Modifier.weight(1f), enabled = !draft.saving)
                }
                if (state.photoPreview) {
                    Text(
                        stringResource(R.string.cn_c_expenses_photo_preview),
                        style = SkTypography.caption,
                        color = colors.textMuted.color,
                    )
                }
            }
        }
    }
}

/** A 3 by 4 digit pad that edits the whole-rupee text. */
@Composable
private fun Keypad(
    value: String,
    onChange: (String) -> Unit,
) {
    val delete = stringResource(R.string.cn_c_expenses_delete)
    val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("", "0", "⌫"))
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                row.forEach { key ->
                    Box(
                        Modifier
                            .weight(1f)
                            .heightIn(min = 52.dp)
                            .then(
                                if (key.isEmpty()) {
                                    Modifier
                                } else {
                                    Modifier
                                        .clickable(role = Role.Button) {
                                            onChange(
                                                if (key ==
                                                    "⌫"
                                                ) {
                                                    value.dropLast(1)
                                                } else {
                                                    value + key
                                                },
                                            )
                                        }.semantics { if (key == "⌫") contentDescription = delete }
                                },
                            ),
                        contentAlignment = Alignment.Center,
                    ) { Text(key, style = SkTypography.title, color = SkTheme.colors.text.color) }
                }
            }
        }
    }
}

private fun methodLabel(method: PayMethod): Int =
    when (method) {
        PayMethod.Upi -> R.string.cn_c_pay_upi
        PayMethod.Cash -> R.string.cn_c_pay_cash
        PayMethod.Card -> R.string.cn_c_pay_card
        PayMethod.Bank -> R.string.cn_c_pay_bank
    }

private fun problemText(problem: ExpenseProblem): Int =
    when (problem) {
        ExpenseProblem.NoAmount -> R.string.cn_c_expenses_problem_amount
        ExpenseProblem.TooLarge -> R.string.cn_c_expenses_problem_large
        ExpenseProblem.Future -> R.string.cn_c_expenses_problem_future
        ExpenseProblem.NoteTooLong -> R.string.cn_c_expenses_problem_note
    }
