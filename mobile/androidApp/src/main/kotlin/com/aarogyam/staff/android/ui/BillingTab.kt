package com.aarogyam.staff.android.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.billing.BillStatus
import com.aarogyam.staff.billing.BillView
import com.aarogyam.staff.billing.BillingState
import com.aarogyam.staff.billing.BillingStateHolder
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.billing.PaymentForm
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkDivider
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

@StringRes
private fun BillStatus.label(): Int =
    when (this) {
        BillStatus.Issued -> R.string.bill_issued
        BillStatus.PartPaid -> R.string.bill_part_paid
        BillStatus.Paid -> R.string.bill_paid
        BillStatus.Void -> R.string.bill_void
        BillStatus.Unknown -> R.string.bill_unknown
    }

private fun BillStatus.tone(): SkTone =
    when (this) {
        BillStatus.Paid -> SkTone.Success
        BillStatus.PartPaid, BillStatus.Issued -> SkTone.Warning
        BillStatus.Void -> SkTone.Danger
        BillStatus.Unknown -> SkTone.Neutral
    }

@StringRes
private fun PayMethod.label(): Int =
    when (this) {
        PayMethod.Cash -> R.string.pay_cash
        PayMethod.Upi -> R.string.pay_upi
        PayMethod.Card -> R.string.pay_card
    }

/** The Billing tab of Patient 360: balance, the patient's bills and, with `billing.write`, payments. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BillingTab(holder: BillingStateHolder) {
    val state by holder.state.collectAsStateWithLifecycle()
    val loaded = state as? BillingState.Loaded
    PullToRefreshBox(
        isRefreshing = loaded?.refreshing == true,
        onRefresh = holder::refresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        when (val current = state) {
            BillingState.Loading, BillingState.Hidden -> {
                LoadingIndicator()
            }

            is BillingState.Failed -> {
                SkEmptyState(
                    stringResource(R.string.billing_title),
                    stringResource(current.error.message()),
                    actionLabel = stringResource(R.string.try_again),
                    onAction = holder::refresh,
                )
            }

            is BillingState.Loaded -> {
                BillingContent(current, holder)
            }
        }
    }
}

@Composable
private fun BillingContent(
    state: BillingState.Loaded,
    holder: BillingStateHolder,
) {
    val view = state.view
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(Spacing.ML.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp),
    ) {
        state.error?.let { item { ErrorLine(stringResource(it.message())) } }
        state.receipt?.let { receipt ->
            item { SkChip(stringResource(R.string.payment_recorded, receipt), tone = SkTone.Success) }
        }
        item {
            SkCard {
                Text(
                    stringResource(R.string.balance_title),
                    style = SkTypography.headline,
                    color = SkTheme.colors.text.color,
                )
                if (view.balancePaise > 0) {
                    Text(
                        stringResource(R.string.balance_due, view.balancePaise.rupees()),
                        style = SkTypography.headline,
                        color = SkTheme.colors.dangerText.color,
                    )
                } else {
                    Text(
                        stringResource(R.string.balance_clear),
                        style = SkTypography.footnote,
                        color = SkTheme.colors.textMuted.color,
                    )
                }
            }
        }
        if (view.bills.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.bills_none),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.textMuted.color,
                )
            }
        } else {
            item {
                Text(
                    stringResource(R.string.bills_title),
                    style = SkTypography.headline,
                    color = SkTheme.colors.text.color,
                )
            }
            items(view.bills, key = { it.id }) { bill -> BillRow(bill, onPay = { holder.startPayment(bill.id) }) }
        }
    }
    state.form?.let { PaymentSheet(it, holder) }
}

@Composable
private fun ErrorLine(text: String) = Text(text, style = SkTypography.footnote, color = SkTheme.colors.dangerText.color)

@Composable
private fun BillRow(
    bill: BillView,
    onPay: () -> Unit,
) {
    SkCard {
        SkListRow(
            title = bill.number ?: stringResource(R.string.bill_no_number),
            subtitle =
                listOfNotNull(
                    bill.issuedOn?.display(),
                    stringResource(R.string.bill_total, bill.totalPaise.rupees()),
                ).joinToString(" · "),
            trailing = { SkChip(stringResource(bill.status.label()), tone = bill.status.tone()) },
        )
        if (bill.balancePaise > 0) {
            SkDivider()
            Text(
                stringResource(R.string.balance_due, bill.balancePaise.rupees()),
                style = SkTypography.bodyText,
                color = SkTheme.colors.dangerText.color,
                modifier = Modifier.padding(top = Spacing.SM.dp),
            )
        }
        if (bill.canRecordPayment) {
            SkButton(
                stringResource(R.string.record_payment),
                onClick = onPay,
                modifier = Modifier.fillMaxWidth().padding(top = Spacing.SM.dp),
            )
        }
    }
}

@Composable
private fun PaymentSheet(
    form: PaymentForm,
    holder: BillingStateHolder,
) {
    SkBottomSheet(
        title = stringResource(R.string.record_payment),
        subtitle = stringResource(R.string.payment_balance, form.balancePaise.rupees()),
        onDismiss = holder::cancelPayment,
    ) {
        SkTextField(
            value = form.amountText,
            onValueChange = holder::setAmount,
            label = stringResource(R.string.payment_amount),
            isError = form.amountInvalid,
            supportingText = if (form.amountInvalid) stringResource(R.string.payment_amount_invalid) else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.M.dp),
        )
        Row(
            Modifier.fillMaxWidth().padding(top = Spacing.M.dp),
            horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
        ) {
            PayMethod.entries.forEach { method ->
                SkButton(
                    stringResource(method.label()),
                    onClick = { holder.setMethod(method) },
                    variant = if (method == form.method) SkButtonVariant.Primary else SkButtonVariant.Secondary,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        SkTextField(
            value = form.reference,
            onValueChange = holder::setReference,
            label = stringResource(R.string.payment_reference),
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.M.dp),
        )
        form.error?.let { ErrorLine(stringResource(it.message())) }
        SkButton(
            stringResource(if (form.submitting) R.string.payment_recording else R.string.record_payment),
            onClick = holder::submitPayment,
            enabled = !form.submitting,
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.L.dp),
        )
    }
}
