package com.aarogyam.staff.android.ui.clinical

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.StatusBarTone
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.expenses.ExpenseRow
import com.aarogyam.staff.expenses.ExpensesStateHolder
import com.aarogyam.staff.expenses.RecurringExpensesStateHolder
import com.aarogyam.staff.expenses.SpendCategory
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import java.time.LocalDate
import java.time.format.TextStyle

/**
 * The month's expenses: a total card, the clinic's recurring expenses (when [recurring] is given),
 * then one row per expense, voided ones struck through. Add opens the keypad sheet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExpensesScreen(
    holder: ExpensesStateHolder,
    onBack: (() -> Unit)?,
    showsAdd: Boolean = true,
    recurring: RecurringExpensesStateHolder? = null,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val recur = recurring?.state?.collectAsStateWithLifecycle()?.value
    var adding by remember { mutableStateOf(false) }
    var addingRecurring by remember { mutableStateOf(false) }
    var stopping by remember { mutableStateOf<String?>(null) }
    var billOf by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize()) {
        StatusBarTone.DarkHeader()
        SkTopBar(
            title = stringResource(R.string.cn_c_expenses_title),
            navigation = {
                if (onBack != null) BarAction(stringResource(R.string.back), SkTheme.colors.onBrandDark.color, onBack)
            },
            actions = {
                if (showsAdd && state.canAdd) {
                    BarAction(stringResource(R.string.cn_c_expenses_add), SkTheme.colors.onBrandDark.color, {
                        adding =
                            true
                    })
                }
            },
        )
        PullToRefreshBox(
            isRefreshing = state.loading && state.rows.isNotEmpty(),
            onRefresh = {
                holder.refresh()
                recurring?.refresh()
            },
            modifier = Modifier.weight(1f),
        ) {
            val error = state.error
            if (!state.allowed) {
                SkEmptyState(
                    stringResource(R.string.cn_c_expenses_not_allowed_title),
                    stringResource(R.string.cn_c_expenses_not_allowed_message),
                )
            } else {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(Spacing.ML.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    item { TotalCard(state.totalPaise, state.rows.count { !it.void }) }
                    if (recurring != null && recur != null) {
                        recurringSection(
                            recur,
                            RecurringActions(
                                onAdd = {
                                    if (recur.draft.saved) recurring.resetDraft()
                                    addingRecurring = true
                                },
                                onPause = recurring::pause,
                                onResume = recurring::resume,
                                onStop = { stopping = it },
                                onRetry = recurring::refresh,
                            ),
                        )
                        item(key = "month-header") {
                            SectionLabel(
                                stringResource(R.string.cn_c_recur_this_month),
                                Modifier.padding(top = Spacing.SM.dp),
                            )
                        }
                    }
                    when {
                        error != null -> {
                            item {
                                SkEmptyState(
                                    stringResource(R.string.cn_c_expenses_title),
                                    stringResource(error.message()),
                                    actionLabel = stringResource(R.string.try_again),
                                    onAction = holder::refresh,
                                )
                            }
                        }

                        state.loading && state.rows.isEmpty() -> {
                            item { Box(Modifier.fillMaxWidth().padding(Spacing.XL.dp)) { LoadingIndicator() } }
                        }

                        state.rows.isEmpty() -> {
                            item {
                                SkEmptyState(
                                    stringResource(R.string.cn_c_expenses_empty_title),
                                    stringResource(R.string.cn_c_expenses_empty_message),
                                )
                            }
                        }
                    }
                    items(state.rows, key = { it.id }) { row ->
                        // Those who may edit expenses choose to open or remove the bill; others open it.
                        ExpenseItem(row) { if (state.canAdd) billOf = row.id else holder.openBill(row.id) }
                    }
                }
            }
        }
    }
    if (adding) ExpenseSheet(holder, onDismiss = { adding = false })
    if (addingRecurring && recurring != null) RecurringSheet(recurring, onDismiss = { addingRecurring = false })
    stopping?.let { id -> StopRecurringDialog({ stopping = null }, { recurring?.stop(id) }) }
    val actionError = recur?.actionError
    if (recurring != null && actionError != null) {
        val error = actionError
        AlertDialog(
            onDismissRequest = recurring::clearActionError,
            text = { Text(stringResource(error.message())) },
            confirmButton = {
                TextButton(
                    onClick = recurring::clearActionError,
                ) { Text(stringResource(R.string.done)) }
            },
        )
    }
    BillLinkEffect(
        state.billLink,
        state.billLinkFailed || state.billRemoveFailed,
        state.billRemoveFailed,
        holder::closeBill,
    )
    billOf?.let { id -> BillActions({ billOf = null }, { holder.openBill(id) }, { holder.removeBill(id) }) }
}

@Composable
private fun TotalCard(
    paise: Long,
    count: Int,
) {
    val colors = SkTheme.colors
    val month =
        LocalDate.now().month.getDisplayName(
            TextStyle.FULL,
            androidx.compose.ui.platform.LocalConfiguration.current.locales[0],
        ) +
            " " +
            LocalDate.now().year
    SkCard(Modifier.padding(bottom = Spacing.SM.dp)) {
        Text(month.uppercase(), style = SkTypography.overline, color = colors.textMuted.color)
        Text(paise.rupees(), style = SkTypography.largeTitle, color = colors.text.color, maxLines = 1)
        Text(
            stringResource(R.string.cn_c_expenses_entries, count),
            style = SkTypography.footnote,
            color = colors.textMuted.color,
        )
    }
}

/** One expense: category, date, method and note; with a bill photo, a tap opens it. */
@Composable
private fun ExpenseItem(
    row: ExpenseRow,
    onOpenBill: () -> Unit,
) {
    val colors = SkTheme.colors
    val title = row.categoryName.ifEmpty { stringResource(categoryLabel(row.category)) }
    val method = row.method?.let { stringResource(methodLabel(it)) }
    Box(Modifier.clip(RoundedCornerShape(16.dp)).background(colors.card.color).alpha(if (row.void) 0.65f else 1f)) {
        SkListRow(
            title = title,
            subtitle = ClinicalFormat.joinDot(listOf(ClinicalFormat.date(row.day.toString()), method, row.note)),
            onClick = if (row.hasBill) onOpenBill else null,
            trailing = {
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        row.amountPaise.rupees(),
                        style = SkTypography.bodyStrong,
                        color = colors.text.color,
                        textDecoration = if (row.void) TextDecoration.LineThrough else null,
                    )
                    if (row.void) SkChip(stringResource(R.string.cn_c_expenses_void), tone = SkTone.Danger)
                    if (row.recurring) SkChip(stringResource(R.string.cn_c_recur_tag), tone = SkTone.Brand)
                    if (row.hasBill) SkChip(stringResource(R.string.cn_c_expenses_bill_open), tone = SkTone.Neutral)
                }
            },
        )
    }
}

fun categoryLabel(category: SpendCategory): Int =
    when (category) {
        SpendCategory.Salary -> R.string.cn_c_cat_salary
        SpendCategory.Material -> R.string.cn_c_cat_material
        SpendCategory.Electricity -> R.string.cn_c_cat_electricity
        SpendCategory.Lab -> R.string.cn_c_cat_lab
        SpendCategory.Rent -> R.string.cn_c_cat_rent
        SpendCategory.Other -> R.string.cn_c_cat_other
    }
