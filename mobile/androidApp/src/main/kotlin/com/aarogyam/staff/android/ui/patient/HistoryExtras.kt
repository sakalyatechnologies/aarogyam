package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.history.ToothWork
import com.aarogyam.staff.history.ToothWorkKind
import com.aarogyam.staff.history.VisitRow
import com.sakalya.mobile.design.HexColor
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** The most advanced work on [tooth] in the visit: done beats in progress beats planned. */
internal fun VisitRow.workOf(tooth: Int): ToothWork? =
    work.filter { it.tooth == tooth }.maxByOrNull {
        when (it.kind) {
            ToothWorkKind.Done, ToothWorkKind.Elsewhere -> 4
            ToothWorkKind.InProgress -> 3
            ToothWorkKind.Planned -> 2
            ToothWorkKind.Found -> 1
        }
    }

@Composable
internal fun workText(work: ToothWork): String {
    val kind =
        stringResource(
            when (work.kind) {
                ToothWorkKind.Done -> R.string.p9_work_done
                ToothWorkKind.Planned -> R.string.p9_work_planned
                ToothWorkKind.InProgress -> R.string.p9_work_in_progress
                ToothWorkKind.Elsewhere -> R.string.p9_work_elsewhere
                ToothWorkKind.Found -> R.string.p9_work_found
            },
        )
    return listOfNotNull(work.label, kind).joinToString(", ")
}

/** Done reads calm (primary), planned or in progress reads warm (tertiary), the rest neutral. */
@Composable
internal fun workColors(work: ToothWork): Pair<HexColor, HexColor> {
    val p = SkTheme.palette
    return when (work.kind) {
        ToothWorkKind.Done -> p.primaryContainer to p.onPrimaryContainer
        ToothWorkKind.Planned, ToothWorkKind.InProgress -> p.tertiaryContainer to p.onTertiaryContainer
        ToothWorkKind.Elsewhere, ToothWorkKind.Found -> p.surface2 to p.onSurfaceVariant
    }
}

/** The note's first line, the medicines and the plans, each one line; for the card and its spoken label. */
@Composable
internal fun historyDetailLines(row: VisitRow): List<String> =
    listOfNotNull(
        row.noteLine,
        row.medicines.takeIf { it.isNotEmpty() }?.let {
            stringResource(
                R.string.p9_history_rx_line,
                it.joinToString(", "),
            )
        },
        row.plans.takeIf { it.isNotEmpty() }?.let { plans ->
            stringResource(R.string.p9_history_plan_line, plans.joinToString(", ") { it.title })
        },
    )

@Composable
internal fun HistoryDetails(row: VisitRow) {
    val lines = historyDetailLines(row)
    if (lines.isEmpty()) return
    Column(Modifier.padding(top = 4.dp)) {
        lines.forEachIndexed { i, line ->
            Text(
                line,
                style = v7(12f, if (i == 0 && row.noteLine != null) FontWeight.Medium else FontWeight.Normal),
                color = SkTheme.palette.onSurfaceVariant.color,
                maxLines = if (i == 0 && row.noteLine != null) 2 else 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
internal fun OlderVisitsButton(
    loading: Boolean,
    onClick: () -> Unit,
) {
    TextButton(onClick, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = !loading) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        } else {
            Text(stringResource(R.string.p9_history_more), color = SkTheme.palette.primary.color)
        }
    }
}
