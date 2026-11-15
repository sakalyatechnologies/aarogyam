package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.chart.FindingSwatch
import com.aarogyam.staff.android.ui.chart.label
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.chart.ChartState
import com.aarogyam.staff.chart.ChartStateHolder
import com.aarogyam.staff.chart.EntryStatus
import com.aarogyam.staff.chart.Finding
import com.aarogyam.staff.chart.HistoryEntryView
import com.aarogyam.staff.chart.HistoryState
import com.aarogyam.staff.chart.Surface
import com.aarogyam.staff.chart.SurfaceFinding
import com.aarogyam.staff.chart.ToothSelection
import com.aarogyam.staff.chart.ToothView
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** The tooth sheet: the picked tooth (or the group) with its history and Edit, and Add treatment. */
@Composable
internal fun ToothSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    chartHolder: ChartStateHolder,
    chart: ChartState.Loaded,
    selection: ToothSelection,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val sheet = remember { graph.toothSheet(clinic, chartHolder, null, scope) }
    val form by sheet.form.collectAsStateWithLifecycle()
    val group = if (chart.several) chart.group else emptyList()
    val isGroup = group.size > 1
    var adding by remember { mutableStateOf(false) }
    val tooth = selection.tooth
    LaunchedEffect(form.saved) {
        if (form.saved) {
            sheet.reset()
            adding = false
            onDismiss()
        }
    }
    SkModalSheet(
        title =
            if (isGroup) {
                stringResource(R.string.pv_tooth_group, group.size)
            } else {
                stringResource(R.string.pv_tooth_title, tooth.number)
            },
        subtitle = if (isGroup) group.joinToString(", ") else toothName(tooth),
        onDismiss = onDismiss,
    ) {
        if (adding || isGroup) {
            AddTreatmentForm(chartHolder, chart, sheet, form, tooth) {
                if (isGroup) {
                    onDismiss()
                } else {
                    adding = false
                    sheet.reset()
                }
            }
        } else {
            NowCard(tooth)
            HistoryCard(tooth, selection.history, chart.canRecord) { entry ->
                sheet.startEdit(entry, chart.terms)
                adding = true
            }
            if (chart.canRecord) {
                SkPillButton(stringResource(R.string.pv_tooth_add), {
                    sheet.reset()
                    adding = true
                }, wide = true)
            }
        }
    }
}

@Composable
private fun toothName(tooth: ToothView): String {
    val quadrant =
        when (Quadrant.of(tooth.number)) {
            Quadrant.UpperRight -> R.string.pv_tooth_upper_right
            Quadrant.UpperLeft -> R.string.pv_tooth_upper_left
            Quadrant.LowerLeft -> R.string.pv_tooth_lower_left
            Quadrant.LowerRight -> R.string.pv_tooth_lower_right
        }
    return stringResource(quadrant) + " · " + stringResource(tooth.kind.label())
}

@Composable
private fun surfaceText(
    tooth: ToothView,
    surface: Surface?,
): String =
    if (surface ==
        null
    ) {
        stringResource(R.string.chart_whole_tooth)
    } else {
        stringResource(tooth.surfaceName(surface).label())
    }

/** What is on the tooth now: a crown in its colour and one line per finding. */
@Composable
private fun NowCard(tooth: ToothView) {
    val p = SkTheme.palette
    val findings = tooth.findings.ifEmpty { listOf(SurfaceFinding(null, Finding.Sound)) }
    V7Card {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            val paint = JawPaint.of(JawTone.of(tooth.headline))
            Box(Modifier.size(44.dp).background(paint.dot, CircleShape), contentAlignment = Alignment.Center) {
                Text(tooth.number.toString(), style = v7(13f, FontWeight.Bold), color = paint.ink)
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                V7Label(stringResource(R.string.pv_tooth_now))
                findings.forEach { item ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FindingSwatch(item.finding)
                        Text(
                            stringResource(item.finding.label()) + ", " + surfaceText(tooth, item.surface),
                            style = v7(13f),
                            color = p.onSurface.color,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HistoryCard(
    tooth: ToothView,
    history: HistoryState,
    canRecord: Boolean,
    onEdit: (HistoryEntryView) -> Unit,
) {
    when (history) {
        HistoryState.Loading -> {
            V7Muted(stringResource(R.string.pv_loading))
        }

        is HistoryState.Failed -> {
            Text(stringResource(R.string.chart_history_failed), style = v7(12.5f), color = SkTheme.palette.error.color)
        }

        is HistoryState.Loaded -> {
            if (history.entries.isEmpty()) {
                V7Muted(stringResource(R.string.chart_history_none))
            } else {
                V7Card {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        history.entries.forEach { HistoryRow(tooth, it, canRecord, onEdit) }
                    }
                }
            }
        }
    }
}

@Composable
private fun HistoryRow(
    tooth: ToothView,
    entry: HistoryEntryView,
    canRecord: Boolean,
    onEdit: (HistoryEntryView) -> Unit,
) {
    val p = SkTheme.palette
    val current = entry.status == EntryStatus.Current
    val status =
        when (entry.status) {
            EntryStatus.Current -> null
            EntryStatus.Superseded -> stringResource(R.string.chart_superseded)
            EntryStatus.EnteredInError -> stringResource(R.string.chart_entered_in_error)
        }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            Modifier
                .padding(
                    top = 5.dp,
                    start = 2.dp,
                    end = 2.dp,
                ).size(10.dp)
                .background((if (current) p.primary else p.outline).color, CircleShape),
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                stringResource(entry.finding.label()) + ", " + surfaceText(tooth, entry.surface),
                style = v7(14f, FontWeight.Bold),
                color = (if (current) p.onSurface else p.onSurfaceVariant).color,
            )
            val treatment = listOfNotNull(entry.procedure, entry.material).joinToString(" · ")
            if (treatment.isNotEmpty()) Text(treatment, style = v7(13f), color = p.onSurface.color)
            val details = listOfNotNull(entry.at?.date?.display(), status, entry.note).joinToString(" · ")
            if (details.isNotEmpty()) Text(details, style = v7(12f), color = p.onSurfaceVariant.color)
        }
        if (current && canRecord) {
            Box(
                Modifier
                    .defaultMinSize(minWidth = 44.dp, minHeight = 36.dp)
                    .clickable(role = Role.Button) { onEdit(entry) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(R.string.pv_tooth_edit),
                    style = v7(12f, FontWeight.Bold),
                    color = p.primary.color,
                )
            }
        }
    }
}
