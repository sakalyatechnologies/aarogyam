package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.chart.EntryStatus
import com.aarogyam.staff.chart.HistoryState
import com.aarogyam.staff.chart.TermView
import com.aarogyam.staff.chart.ToothSheetStateHolder
import com.sakalya.mobile.designcompose.SkChoiceChip
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** The tooth's planned and done treatments; tapping a planned one's status chip marks it done. */
@Composable
internal fun ToothTreatmentRows(
    sheet: ToothSheetStateHolder,
    canRecord: Boolean,
    history: HistoryState,
    terms: List<TermView>,
) {
    val rows by sheet.treatmentRows.collectAsStateWithLifecycle()
    // Treatments already on the chart: tapping In progress or Done posts the entry again.
    val entries =
        (history as? HistoryState.Loaded)
            ?.entries
            .orEmpty()
            .filter { it.status == EntryStatus.Current && it.procedure != null }
    if (rows.items.isEmpty() && entries.isEmpty()) return
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            V7Label(stringResource(R.string.pv_tooth_treatments))
            rows.items.forEach { item ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    val surfaces = item.surfaces.joinToString("")
                    Text(
                        listOf(item.name, surfaces).filter { it.isNotEmpty() }.joinToString(" · "),
                        style = v7(14f, FontWeight.SemiBold),
                        color = SkTheme.palette.onSurface.color,
                        modifier = Modifier.weight(1f),
                    )
                    val label =
                        stringResource(if (item.done) R.string.pv_status_completed else R.string.pv_status_planned)
                    SkChoiceChip(
                        label,
                        item.done,
                        { if (!item.done && canRecord) sheet.completeTreatment(item.id) },
                        single = false,
                    )
                }
            }
            entries.forEach { entry ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        listOfNotNull(entry.procedure, entry.surface?.name).joinToString(" · "),
                        style = v7(14f, FontWeight.SemiBold),
                        color = SkTheme.palette.onSurface.color,
                        modifier = Modifier.weight(1f),
                    )
                    val states = listOf(true to R.string.pv_status_in_progress, false to R.string.pv_status_completed)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        states.forEach { (started, label) ->
                            SkChoiceChip(
                                stringResource(label),
                                entry.inProgress == started,
                                { if (canRecord) sheet.setEntryProgress(entry, terms, started) },
                                single = false,
                            )
                        }
                    }
                }
            }
            rows.error?.let {
                Text(stringResource(it.message()), style = v7(12.5f), color = SkTheme.palette.error.color)
            }
        }
    }
}

/** A collapsed "More details" row; [content] shows when it is open. */
@Composable
internal fun MoreDetails(content: @Composable () -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 44.dp)
            .clickable(role = Role.Button) { open = !open },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            stringResource(R.string.pv_tooth_more),
            style = v7(13f, FontWeight.Bold),
            color = SkTheme.palette.primary.color,
            modifier = Modifier.weight(1f),
        )
        V7Icon("chev", SkTheme.palette.primary.color, 16.dp)
    }
    if (open) content()
}
