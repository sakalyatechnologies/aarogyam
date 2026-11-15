package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.history.VisitHistoryState
import com.aarogyam.staff.history.VisitHistoryStateHolder
import com.aarogyam.staff.history.VisitRow
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.todayIn
import kotlin.time.Clock

/** The History tab: one card per visit, newest first. A tap opens the visit's detail. */
@Composable
internal fun HistoryTab(
    holder: VisitHistoryStateHolder,
    clinic: ClinicContext,
    onOpen: (String) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val title = stringResource(R.string.p9_tab_history)
    when (val current = state) {
        VisitHistoryState.Loading -> {
            SectionState(title, SectionKind.Loading)
        }

        VisitHistoryState.NotAllowed -> {
            SectionState(title, SectionKind.NotAllowed)
        }

        is VisitHistoryState.Failed -> {
            SectionState(title, SectionKind.Failed(current.error), holder::refresh)
        }

        is VisitHistoryState.Loaded -> {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                current.error?.let { ErrorLine(it) }
                if (current.rows.isEmpty()) {
                    V7Card { V7Muted(stringResource(R.string.p9_history_none), Modifier.fillMaxWidth()) }
                } else {
                    val today = remember { Clock.System.todayIn(clinic.timeZone) }
                    current.rows.forEach { row -> HistoryCard(row, today) { onOpen(row.id) } }
                }
            }
        }
    }
}

@Composable
internal fun historyTitleText(title: HistoryTitle): String =
    when (title) {
        is HistoryTitle.Text -> title.value
        HistoryTitle.Appointment -> stringResource(R.string.p9_title_appointment)
        HistoryTitle.WalkIn -> stringResource(R.string.p9_title_walkin)
        HistoryTitle.Visit -> stringResource(R.string.p9_title_visit)
    }

@Composable
private fun HistoryChip.title(): String =
    when (this) {
        is HistoryChip.Tooth -> number.toString()
        is HistoryChip.DueAmount -> stringResource(R.string.p9_chip_due_amount, text)
        HistoryChip.Notes -> stringResource(R.string.p9_chip_notes)
        HistoryChip.Rx -> stringResource(R.string.p9_chip_rx)
        HistoryChip.Photos -> stringResource(R.string.p9_chip_photos)
        HistoryChip.Paid -> stringResource(R.string.p9_chip_paid)
        HistoryChip.Due -> stringResource(R.string.p9_chip_due)
        HistoryChip.Open -> stringResource(R.string.p9_chip_open)
    }

@Composable
private fun HistoryChip.spoken(): String =
    if (this is HistoryChip.Tooth) stringResource(R.string.p9_chip_tooth_a11y, number) else title()

/** A History card: the date badge, the title, the doctor, and chips for what the visit holds. */
@Composable
private fun HistoryCard(
    row: VisitRow,
    today: kotlinx.datetime.LocalDate,
    onTap: () -> Unit,
) {
    val p = SkTheme.palette
    val badge = HistoryRowFormat.badge(row.at.date, today)
    val chips =
        HistoryRowFormat.chips(
            row.hasNotes,
            row.hasRx,
            row.hasPhotos,
            row.bill,
            row.open,
            row.teeth,
            row.duePaise,
        )
    val title = historyTitleText(HistoryRowFormat.title(row.titleSource))
    val todayText = stringResource(R.string.p9_today)
    val spokenChips = chips.map { it.spoken() }
    val description = (listOf(row.at.date.display(), title, row.clinician) + spokenChips).joinToString(", ")
    V7Card(Modifier.clearAndSetSemantics { contentDescription = description }, onClick = onTap) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(
                Modifier
                    .defaultMinSize(minWidth = 52.dp, minHeight = 52.dp)
                    .background((if (badge.isToday) p.primary else p.primaryContainer).color, RoundedCornerShape(16.dp))
                    .padding(horizontal = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                val ink = (if (badge.isToday) p.onPrimary else p.onPrimaryContainer).color
                Text(
                    if (badge.isToday) todayText else badge.top,
                    style = v7(if (badge.isToday) 13f else 18f, FontWeight.ExtraBold),
                    color = ink,
                )
                badge.bottom?.let { Text(it, style = v7(11.5f, FontWeight.Bold), color = ink) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, style = v7(14.5f, FontWeight.Bold), color = p.onSurface.color)
                Text(row.clinician, style = v7(12f), color = p.onSurfaceVariant.color)
                if (chips.isNotEmpty()) Flow(Modifier.padding(top = 2.dp)) { chips.forEach { ChipView(it) } }
            }
            V7Icon("chev", p.onSurfaceVariant.color, 18.dp)
        }
    }
}

@Composable
private fun ChipView(chip: HistoryChip) {
    val p = SkTheme.palette
    val (fill, ink) =
        when (chip) {
            HistoryChip.Paid -> p.primaryContainer to p.onPrimaryContainer
            HistoryChip.Due, is HistoryChip.DueAmount -> p.errorContainer to p.onErrorContainer
            HistoryChip.Open -> p.tertiaryContainer to p.onTertiaryContainer
            else -> p.surface2 to p.onSurfaceVariant
        }
    Row(
        Modifier.background(fill.color, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (chip is HistoryChip.Tooth) V7Icon("tooth", ink.color, 11.dp)
        Text(chip.title(), style = v7(11f, FontWeight.Bold), color = ink.color)
    }
}
