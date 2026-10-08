package com.aarogyam.patient.android.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.patient.android.R
import com.aarogyam.patient.records.BillView
import com.aarogyam.patient.records.BillsStateHolder
import com.aarogyam.patient.records.ListState
import com.aarogyam.patient.records.MedicineView
import com.aarogyam.patient.records.PrescriptionView
import com.aarogyam.patient.records.PrescriptionsStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkDivider
import com.sakalya.mobile.designcompose.SkHeroCard
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Issued prescriptions from every clinic, each with its verified copy. */
@Composable
fun PrescriptionsScreen(
    holder: PrescriptionsStateHolder,
    onBack: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    PatientScreen(stringResource(R.string.prescriptions), onBack = onBack) {
        when (val current = state) {
            ListState.Loading -> {
                item { LoadingIndicator() }
            }

            is ListState.Failed -> {
                item { ErrorState(current.error, holder::refresh) }
            }

            is ListState.Loaded -> {
                if (current.items.isEmpty()) {
                    item {
                        SkCard {
                            BodyText(
                                stringResource(R.string.prescriptions_empty),
                                muted = true,
                            )
                        }
                    }
                }
                items(current.items, key = { it.id }) { PrescriptionCard(it) }
            }
        }
    }
}

@Composable
private fun PrescriptionCard(rx: PrescriptionView) {
    val context = LocalContext.current
    SkCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            Text(rx.issuedAt?.date().orEmpty(), style = SkTypography.headline, color = SkTheme.colors.text.color)
            BodyText(stringResource(R.string.issued_by, rx.doctorName ?: rx.number, rx.clinicName), muted = true)
            SkDivider()
            rx.medicines.forEach { Medicine(it) }
            rx.advice?.let { BodyText(it) }
            rx.followUpOn?.let { BodyText(stringResource(R.string.follow_up_on, it), muted = true) }
            rx.verifyUrl?.let { url ->
                SkButton(
                    stringResource(R.string.verify_prescription),
                    { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) },
                    Modifier.fillMaxWidth(),
                    variant = SkButtonVariant.Secondary,
                )
            }
        }
    }
}

@Composable
private fun Medicine(medicine: MedicineView) {
    Column {
        Text(
            listOfNotNull(medicine.name, medicine.strength).joinToString(" "),
            style = SkTypography.label,
            color = SkTheme.colors.text.color,
        )
        val timing = medicine.timing?.let { stringResource(timingText(it)) }
        val days = medicine.days?.let { pluralStringResource(R.plurals.for_days, it, it) }
        BodyText(listOfNotNull(medicine.dose, medicine.frequency, timing, days).joinToString(" · "), muted = true)
        medicine.instructions?.let { BodyText(it, muted = true) }
    }
}

private fun timingText(timing: String): Int =
    when (timing) {
        "before_food" -> R.string.timing_before_food
        "after_food" -> R.string.timing_after_food
        "empty_stomach" -> R.string.timing_empty_stomach
        "bedtime" -> R.string.timing_bedtime
        "sos" -> R.string.timing_sos
        else -> R.string.timing_as_directed
    }

/** Bills from every clinic and what is still due; read only, the patient pays at the clinic. */
@Composable
fun BillsScreen(
    holder: BillsStateHolder,
    onBack: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    PatientScreen(stringResource(R.string.bills), onBack = onBack) {
        when (val current = state) {
            ListState.Loading -> {
                item { LoadingIndicator() }
            }

            is ListState.Failed -> {
                item { ErrorState(current.error, holder::refresh) }
            }

            is ListState.Loaded -> {
                val view = current.items.firstOrNull() ?: return@PatientScreen
                item {
                    SkHeroCard(
                        kicker = stringResource(R.string.total_due),
                        title =
                            if (view.balancePaise >
                                0
                            ) {
                                rupees(view.balancePaise)
                            } else {
                                stringResource(R.string.all_paid)
                            },
                        subtitle = "",
                    )
                }
                if (view.bills.isEmpty()) {
                    item {
                        SkCard {
                            BodyText(
                                stringResource(R.string.bills_empty),
                                muted = true,
                            )
                        }
                    }
                }
                items(view.bills, key = { it.id }) { BillCard(it) }
            }
        }
    }
}

@Composable
private fun BillCard(bill: BillView) {
    SkCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(bill.issuedAt?.date().orEmpty(), style = SkTypography.headline, color = SkTheme.colors.text.color)
                Text(
                    if (bill.balancePaise >
                        0
                    ) {
                        stringResource(R.string.bill_due, rupees(bill.balancePaise))
                    } else {
                        stringResource(R.string.bill_paid)
                    },
                    style = SkTypography.label,
                    color =
                        if (bill.balancePaise >
                            0
                        ) {
                            SkTheme.colors.primaryText.color
                        } else {
                            SkTheme.colors.textMuted.color
                        },
                )
            }
            BodyText("${bill.clinicName} · ${bill.number}", muted = true)
            SkDivider()
            bill.lines.forEach { line ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    BodyText(if (line.quantity > 1) "${line.label} × ${line.quantity}" else line.label)
                    BodyText(rupees(line.totalPaise))
                }
            }
            BodyText(stringResource(R.string.bill_total, rupees(bill.totalPaise)), muted = true)
        }
    }
}
