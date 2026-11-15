package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.billing.BillingStateHolder
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.billing.PaymentForm
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

@Composable
private fun PayMethod.title(): String =
    stringResource(
        when (this) {
            PayMethod.Cash -> R.string.pay_cash
            PayMethod.Upi -> R.string.pay_upi
            PayMethod.Card -> R.string.pay_card
        },
    )

/** "Record payment" for one bill: amount, method, reference. */
@Composable
internal fun PaymentSheet(
    holder: BillingStateHolder,
    form: PaymentForm,
) {
    val methods = PayMethod.entries
    val titles = methods.associateWith { it.title() }
    SkModalSheet(
        title = stringResource(R.string.record_payment),
        subtitle = stringResource(R.string.payment_balance, form.balancePaise.rupees()),
        onDismiss = holder::cancelPayment,
    ) {
        SkField(
            stringResource(R.string.payment_amount),
            form.amountText,
            holder::setAmount,
            error = if (form.amountInvalid) stringResource(R.string.payment_amount_invalid) else null,
            keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        )
        V7Label(stringResource(R.string.pv_bills_method))
        SkChoiceChips(methods, setOf(form.method), holder::setMethod, { titles.getValue(it) })
        SkField(stringResource(R.string.payment_reference), form.reference, holder::setReference)
        form.error?.let {
            Text(
                stringResource(it.message()),
                style = v7(12.5f, FontWeight.SemiBold),
                color = SkTheme.palette.error.color,
            )
        }
        SkPillButton(
            stringResource(R.string.record_payment),
            holder::submitPayment,
            wide = true,
            loading = form.submitting,
        )
    }
}
