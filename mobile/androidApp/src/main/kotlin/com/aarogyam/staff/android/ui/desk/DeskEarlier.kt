package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.desk.MissedHolder
import com.aarogyam.staff.desk.MissedState
import com.aarogyam.staff.desk.ToCollectHolder
import com.aarogyam.staff.desk.ToCollectState
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * "Unpaid from earlier days": bills still to collect from before today. Hidden while loading, when the role may not
 * see it, on a failed first load, and when empty. Rows show the clinic number only.
 */
@Composable
fun DeskUnpaidSection(
    holder: ToCollectHolder,
    canCollect: Boolean,
    refreshTick: Int,
    onCollect: (DeskPayTarget) -> Unit,
    /** The role may list the patient's bills (billing.read and billing.write), so one payment can cover several. */
    canSplit: Boolean = false,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    LaunchedEffect(refreshTick) { if (refreshTick > 0) holder.refresh() }
    val loaded = state as? ToCollectState.Loaded ?: return
    if (loaded.items.isEmpty()) return
    var expanded by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val open = expanded ?: !DeskEarlier.startsCollapsed(loaded.items.size)
    Column(Modifier.padding(top = Spacing.XS.dp), verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        EarlierHeader(
            stringResource(R.string.dk_dx_earlier_unpaid_header, loaded.items.size, loaded.totalPaise.rupees()),
            open,
        ) { expanded = !open }
        if (open) {
            // One row per patient: what they owe in all and how many bills; Collect splits one payment.
            loaded.patients.forEach { row ->
                val item = row.bills.first()
                SkCard(Modifier.fillMaxWidth()) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(Spacing.M.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(row.patientNumber, style = SkTypography.bodyStrong, color = SkTheme.colors.text.color)
                            Text(
                                if (row.billCount > 1) {
                                    pluralStringResource(R.plurals.dk_dx_earlier_bills, row.billCount, row.billCount) +
                                        " · " + DeskEarlier.dayText(item.day)
                                } else {
                                    stringResource(R.string.dk_dx_earlier_token, item.tokenNumber) + " · " +
                                        DeskEarlier.dayText(item.day)
                                },
                                style = SkTypography.footnote,
                                color = SkTheme.colors.textMuted.color,
                            )
                        }
                        Text(
                            row.totalPaise.rupees(),
                            style = SkTypography.bodyStrong,
                            color = SkTheme.colors.text.color,
                        )
                        if (canCollect) {
                            SkButton(
                                stringResource(R.string.dk_dx_earlier_collect),
                                onClick = {
                                    // Billing roles see all the patient's bills; the desk collects one bill at a time.
                                    val whole = row.billCount > 1 && canSplit
                                    onCollect(
                                        DeskPayTarget(
                                            item.patientId,
                                            item.patientNumber,
                                            invoiceId = item.invoiceId.takeUnless { whole },
                                        ),
                                    )
                                },
                                variant = SkButtonVariant.Secondary,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** "Missed today": no-shows for the clinic day. A row opens the patient. */
@Composable
fun DeskMissedSection(
    holder: MissedHolder,
    zoneId: String,
    refreshTick: Int,
    onOpenPatient: (String) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    LaunchedEffect(refreshTick) { if (refreshTick > 0) holder.refresh() }
    val loaded = state as? MissedState.Loaded ?: return
    if (loaded.items.isEmpty()) return
    var expanded by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val open = expanded ?: !DeskEarlier.startsCollapsed(loaded.items.size)
    Column(Modifier.padding(top = Spacing.XS.dp), verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        EarlierHeader(
            stringResource(R.string.dk_dx_earlier_missed_header, loaded.items.size),
            open,
        ) { expanded = !open }
        if (open) {
            loaded.items.forEach { item ->
                SkCard(Modifier.fillMaxWidth(), onClick = { onOpenPatient(item.patientId) }) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            item.patientNumber,
                            Modifier.weight(1f),
                            style = SkTypography.bodyStrong,
                            color = SkTheme.colors.text.color,
                        )
                        Text(
                            DeskEarlier.timeText(minuteOfDay(item.startsAt, zoneId)),
                            style = SkTypography.label,
                            color = SkTheme.colors.textMuted.color,
                        )
                    }
                }
            }
        }
    }
}

/** The section title with its count; a tap folds the list. */
@Composable
private fun EarlierHeader(
    title: String,
    open: Boolean,
    toggle: () -> Unit,
) {
    val hint = stringResource(if (open) R.string.dk_dx_earlier_collapse else R.string.dk_dx_earlier_expand)
    Row(Modifier.fillMaxWidth().semantics { heading() }, verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), style = SkTypography.headline, color = SkTheme.colors.text.color)
        SkButton(hint, onClick = toggle, variant = SkButtonVariant.Secondary)
    }
}
