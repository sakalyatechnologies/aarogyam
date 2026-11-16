package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.billing.BillingState
import com.aarogyam.staff.billing.BillingStateHolder
import com.aarogyam.staff.history.VisitDetailView
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** The signed prescription of a visit, to send again. */
internal data class VisitRxRef(
    val id: String,
    val number: String?,
)

@Composable
internal fun RxCard(
    view: VisitDetailView,
    canSend: Boolean,
    onSend: (VisitRxRef) -> Unit,
) {
    val rx = view.rx
    if (rx == null) {
        V7Card { V7Muted(stringResource(R.string.p9_visit_rx_none)) }
        return
    }
    val state = stringResource(if (rx.issued) R.string.p9_visit_rx_signed else R.string.p9_visit_rx_draft)
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionHead(stringResource(R.string.p9_visit_rx), listOfNotNull(rx.number, state).joinToString(" · "))
            rx.items.forEach { item ->
                MedicineCard(
                    name = listOfNotNull(item.name, item.strength).joinToString(" "),
                    form = item.form,
                    display = DoseDisplay.make(item.frequency, item.timing, item.durationDays, item.form),
                )
            }
            if (rx.issued && canSend) {
                SkPillButton(
                    stringResource(R.string.p9_visit_rx_send),
                    { onSend(VisitRxRef(rx.id, rx.number)) },
                    variant = SkPillVariant.Tonal,
                    icon = PatientIcons.of("wa"),
                    wide = true,
                )
            }
        }
    }
}

@Composable
internal fun FilesCard(view: VisitDetailView) {
    if (view.files.isEmpty()) return
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHead(stringResource(R.string.p9_media), view.files.size.toString())
            MediaGrid(view.files.map { MediaTileData(it.kind == "xray", it.label, null) })
        }
    }
}

@Composable
internal fun BillCard(
    view: VisitDetailView,
    billing: BillingStateHolder,
    billLoaded: BillingState.Loaded?,
) {
    if (!view.moneyVisible) return
    val p = SkTheme.palette
    val bill = view.bill
    if (bill == null) {
        V7Card { V7Muted(stringResource(R.string.p9_visit_bill_none)) }
        return
    }
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHead(stringResource(R.string.p9_visit_bill), bill.number)
            BillLine(stringResource(R.string.p9_bill_total), bill.totalPaise, null)
            BillLine(stringResource(R.string.p9_bill_paid), bill.paidPaise, null)
            if (bill.balancePaise > 0) BillLine(stringResource(R.string.p9_bill_due), bill.balancePaise, p.error.color)
            billLoaded?.receipt?.let { V7Pill(stringResource(R.string.pv_bills_recorded, it), PillKind.Done) }
            billLoaded?.error?.let { Text(stringResource(it.message()), style = v7(12.5f), color = p.error.color) }
            if (bill.balancePaise > 0) {
                if (billLoaded?.canRecord == true) {
                    SkPillButton(stringResource(R.string.p9_bill_record), {
                        billing.startPayment(bill.id)
                    }, variant = SkPillVariant.Warm, wide = true)
                }
            } else {
                V7Pill(stringResource(R.string.p9_bill_paid_full), PillKind.Done)
            }
        }
    }
}

@Composable
private fun BillLine(
    label: String,
    paise: Long,
    tone: androidx.compose.ui.graphics.Color?,
) {
    val ink = tone ?: SkTheme.palette.onSurface.color
    Row(Modifier.semantics(mergeDescendants = true) {}) {
        Text(label, style = v7(14f), color = ink, modifier = Modifier.weight(1f))
        Text(paise.rupees(), style = v7(14f, FontWeight.Bold), color = ink)
    }
}
