package com.aarogyam.staff.android.ui.desk

import android.content.Context
import android.content.Intent
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.dayLabel
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.desk.Receipt
import com.aarogyam.staff.desk.ReceiptEmail
import com.aarogyam.staff.desk.ReceiptEmailHolder
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.LocalDate

/** After Record: Print the receipt, share it to WhatsApp as text, or email it (messages.send only). */
@Composable
internal fun DeskReceiptActions(
    receipt: Receipt,
    patientName: String,
    email: ReceiptEmailHolder,
) {
    val context = LocalContext.current
    val state by email.state.collectAsStateWithLifecycle()
    val labels =
        ReceiptLabels(
            title = stringResource(R.string.dk_d9_pay_rc_title),
            number = stringResource(R.string.dk_d9_pay_rc_number),
            date = stringResource(R.string.dk_d9_pay_rc_date),
            patient = stringResource(R.string.dk_d9_pay_rc_patient),
            bill = stringResource(R.string.dk_d9_pay_rc_bill),
            method = stringResource(R.string.dk_d9_pay_rc_method),
            amount = stringResource(R.string.dk_d9_pay_rc_amount),
        )
    val methodName = methodName(receipt.method)
    val day = runCatching { LocalDate.parse(receipt.receivedOn).dayLabel() }.getOrDefault(receipt.receivedOn)
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SkPillButton(
            stringResource(R.string.dk_d9_pay_print),
            { printReceipt(context, receipt, patientName, labels, methodName, day) },
            Modifier.weight(1f),
            variant = SkPillVariant.Tonal,
        )
        SkPillButton(
            stringResource(R.string.dk_d9_pay_whatsapp),
            {
                val send =
                    Intent(
                        Intent.ACTION_SEND,
                    ).setType("text/plain").putExtra(Intent.EXTRA_TEXT, receipt.shareText())
                context.startActivity(Intent.createChooser(send, null))
            },
            Modifier.weight(1f),
            variant = SkPillVariant.Tonal,
        )
        if (email.canEmail) {
            SkPillButton(
                stringResource(R.string.dk_d9_pay_email),
                { email.send(receipt) },
                Modifier.weight(1f),
                variant = SkPillVariant.Tonal,
                loading = state == ReceiptEmail.Sending,
            )
        }
    }
    emailNote(state)?.let { (text, good) ->
        Text(
            stringResource(text),
            style = SkTypography.footnote,
            color = if (good) SkTheme.colors.textMuted.color else SkTheme.colors.dangerText.color,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

private fun emailNote(state: ReceiptEmail): Pair<Int, Boolean>? =
    when (state) {
        ReceiptEmail.Idle, ReceiptEmail.Sending -> null
        ReceiptEmail.Queued -> R.string.dk_d9_pay_email_queued to true
        ReceiptEmail.NoEmail -> R.string.dk_d9_pay_email_no_email to false
        ReceiptEmail.NoConsent -> R.string.dk_d9_pay_email_no_consent to false
        ReceiptEmail.AlreadySent -> R.string.dk_d9_pay_email_already to true
        is ReceiptEmail.Failed -> R.string.dk_d9_pay_email_failed to false
    }

@Composable
private fun methodName(wire: String): String =
    when (wire) {
        "cash" -> stringResource(R.string.pay_cash)
        "upi" -> stringResource(R.string.pay_upi)
        "card" -> stringResource(R.string.pay_card)
        else -> wire
    }

private class ReceiptLabels(
    val title: String,
    val number: String,
    val date: String,
    val patient: String,
    val bill: String,
    val method: String,
    val amount: String,
)

/** Renders the receipt as a small page and hands it to the system print dialog (which also saves a PDF). */
private fun printReceipt(
    context: Context,
    receipt: Receipt,
    patientName: String,
    labels: ReceiptLabels,
    methodName: String,
    day: String,
) {
    fun esc(text: String): String = android.text.Html.escapeHtml(text)

    fun row(
        label: String,
        value: String,
    ) = "<tr><td class=l>${esc(label)}</td><td class=v>${esc(value)}</td></tr>"
    val html =
        buildString {
            append("<html><head><meta charset=utf-8><style>")
            append(
                "body{font-family:sans-serif;margin:24px;color:#111}h1{margin:0 0 4px}h2{margin:0 0 16px;color:#555;font-weight:normal}",
            )
            append("table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #ddd}")
            append(
                ".l{color:#555}.v{text-align:right;font-weight:600}.t .v{font-size:1.3em;font-weight:800}</style></head><body>",
            )
            append("<h1>${esc(receipt.clinicName)}</h1><h2>${esc(labels.title)}</h2><table>")
            append(row(labels.number, receipt.number))
            append(row(labels.date, day))
            append(row(labels.patient, patientName))
            receipt.invoiceNumber?.let { append(row(labels.bill, it)) }
            append(row(labels.method, methodName))
            append("</table><table class=t>")
            append(row(labels.amount, receipt.amountPaise.rupees()))
            append("</table></body></html>")
        }
    val web = WebView(context)
    web.webViewClient =
        object : WebViewClient() {
            override fun onPageFinished(
                view: WebView,
                url: String?,
            ) {
                val manager = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
                manager.print(
                    receipt.number,
                    view.createPrintDocumentAdapter(receipt.number),
                    PrintAttributes.Builder().build(),
                )
            }
        }
    web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
}
