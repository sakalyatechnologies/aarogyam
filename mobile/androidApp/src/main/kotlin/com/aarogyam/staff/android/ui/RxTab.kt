package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.AllergyView
import com.aarogyam.staff.prescriptions.RxListState
import com.aarogyam.staff.prescriptions.RxMedicine
import com.aarogyam.staff.prescriptions.RxStatus
import com.aarogyam.staff.prescriptions.RxSummary
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The Rx tab of Patient 360: the patient's prescriptions, newest first, and a way to write one. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RxTab(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    allergies: List<AllergyView>,
) {
    val holder = rememberHolder { graph.rxList(clinic, patientId, it) }
    val state by holder.state.collectAsStateWithLifecycle()
    var composing by remember { mutableStateOf(false) }
    PullToRefreshBox(
        isRefreshing = (state as? RxListState.Loaded)?.refreshing == true,
        onRefresh = holder::refresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        when (val current = state) {
            RxListState.Loading -> {
                LoadingIndicator()
            }

            RxListState.NotAllowed -> {
                SkEmptyState(stringResource(R.string.patient_tab_rx), stringResource(R.string.rx_not_allowed))
            }

            is RxListState.Failed -> {
                SkEmptyState(
                    stringResource(R.string.patient_tab_rx),
                    stringResource(current.error.message()),
                    actionLabel = stringResource(R.string.try_again),
                    onAction = holder::refresh,
                )
            }

            is RxListState.Loaded -> {
                RxList(current, onNew = { composing = true })
            }
        }
    }
    if (composing) {
        RxSheet(graph, clinic, patientId, allergies, onDismiss = {
            composing = false
            holder.refresh()
        })
    }
}

@Composable
private fun RxList(
    state: RxListState.Loaded,
    onNew: () -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(Spacing.ML.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp),
    ) {
        state.error?.let { error ->
            item {
                Text(
                    stringResource(error.message()),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.dangerText.color,
                )
            }
        }
        if (state.canIssue) {
            item { SkButton(stringResource(R.string.rx_new), onClick = onNew, modifier = Modifier.fillMaxWidth()) }
        }
        if (state.items.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.rx_empty),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.textMuted.color,
                )
            }
        }
        items(state.items, key = { it.id }) { RxCard(it) }
    }
}

@Composable
private fun RxCard(rx: RxSummary) {
    SkCard {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                listOfNotNull(rx.number, rx.at?.date?.display()).joinToString(" · "),
                style = SkTypography.headline,
                color = SkTheme.colors.text.color,
            )
            SkChip(stringResource(rx.status.label()), tone = rx.status.tone())
        }
        rx.diagnosis?.let { Muted(it) }
        rx.medicines.forEach { MedicineLine(it) }
        if (rx.allergyOverridden) {
            SkChip(
                stringResource(R.string.rx_allergy_overridden),
                tone = SkTone.Warning,
                modifier = Modifier.padding(top = Spacing.SM.dp),
            )
        }
    }
}

@Composable
private fun MedicineLine(medicine: RxMedicine) {
    Column(Modifier.padding(top = Spacing.SM.dp)) {
        Text(medicine.name, style = SkTypography.bodyText, color = SkTheme.colors.text.color)
        val detail = listOfNotNull(medicine.dose, medicine.frequency, medicine.durationDays?.let { daysText(it) })
        if (detail.isNotEmpty()) Muted(detail.joinToString(" · "))
    }
}

@Composable
private fun Muted(text: String) = Text(text, style = SkTypography.footnote, color = SkTheme.colors.textMuted.color)

@Composable
internal fun daysText(count: Int): String = pluralStringResource(R.plurals.rx_days, count, count)

private fun RxStatus.label(): Int =
    when (this) {
        RxStatus.Draft -> R.string.rx_status_draft
        RxStatus.Issued -> R.string.rx_status_issued
        RxStatus.Cancelled -> R.string.rx_status_cancelled
        RxStatus.Unknown -> R.string.rx_status_unknown
    }

private fun RxStatus.tone(): SkTone =
    when (this) {
        RxStatus.Issued -> SkTone.Success
        RxStatus.Draft -> SkTone.Warning
        RxStatus.Cancelled -> SkTone.Danger
        RxStatus.Unknown -> SkTone.Neutral
    }
