package com.aarogyam.staff.android.ui.today

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.glass.GroupGap
import com.aarogyam.staff.android.ui.glass.GroupHeader
import com.aarogyam.staff.android.ui.glass.glassChrome
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.tasks.BellFilter
import com.aarogyam.staff.android.ui.tasks.TasksFormat
import com.aarogyam.staff.team.AlertRow
import com.aarogyam.staff.team.ListState
import com.aarogyam.staff.team.NotificationsStateHolder
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkSegmented
import com.sakalya.mobile.designcompose.SkSheetHeader
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import java.time.Instant
import java.time.ZoneId

/**
 * The bell's sheet in Clear Glass: a tonal sheet with "Read all" in its header, a segmented filter, and the
 * notifications grouped under sticky Today and Earlier headers, each row with a tile tinted by its kind.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsSheet(
    holder: NotificationsStateHolder,
    onOpenPatient: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val p = SkTheme.palette
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(),
        shape = RoundedCornerShape(topStart = SHEET_RADIUS.dp, topEnd = SHEET_RADIUS.dp),
        containerColor = p.surface1.color,
        scrimColor = Color.Black.copy(alpha = SCRIM),
        dragHandle = {
            Box(
                Modifier
                    .padding(top = 10.dp, bottom = 6.dp)
                    .size(32.dp, 4.dp)
                    .background(p.outline.color, RoundedCornerShape(2.dp)),
            )
        },
    ) {
        val loaded = state as? ListState.Loaded<AlertRow>
        val unread = loaded?.items?.count { !it.read } ?: 0
        Row(
            Modifier.fillMaxWidth().padding(horizontal = SIDE.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SkSheetHeader(stringResource(R.string.v7_notifications), Modifier.weight(1f))
            if (unread > 0) {
                val full = stringResource(R.string.v7_notifications_read_all)
                SkPillButton(
                    stringResource(R.string.v7_notif_read_all_short),
                    holder::readAll,
                    Modifier.semantics { contentDescription = full },
                    variant = SkPillVariant.Tonal,
                )
            }
        }
        Column(Modifier.padding(horizontal = SIDE.dp).padding(bottom = 8.dp)) {
            when (val s = state) {
                ListState.Loading -> LoadingIndicator()
                ListState.NotAllowed -> Muted(stringResource(R.string.today_not_allowed_message))
                is ListState.Failed -> Muted(stringResource(s.error.message()), color = p.error.color)
                is ListState.Loaded -> if (s.items.isEmpty()) Muted(stringResource(R.string.v7_notifications_none))
            }
        }
        if (loaded != null && loaded.items.isNotEmpty()) BellList(loaded.items.take(MAX), unread, onOpenPatient)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BellList(
    items: List<AlertRow>,
    unread: Int,
    onOpenPatient: (String) -> Unit,
) {
    var filter by rememberSaveable { mutableStateOf(BellFilter.All) }
    val labels =
        BellFilter.entries.map { f ->
            val text = stringResource(f.label())
            if (f == BellFilter.Unread && unread > 0) "$text $unread" else text
        }
    SkSegmented(
        labels,
        filter.ordinal,
        { filter = BellFilter.entries[it] },
        Modifier.padding(horizontal = SIDE.dp).padding(bottom = 4.dp),
    )
    val zone = ZoneId.systemDefault()
    val now = Instant.now()
    val shown = items.filter(filter::keeps)
    val (today, earlier) = shown.partition { TasksFormat.isToday(it.at, zone, now) }
    LazyColumn(
        Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(start = SIDE.dp, end = SIDE.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(GroupGap),
    ) {
        if (shown.isEmpty()) {
            item("none") {
                Muted(stringResource(R.string.v7_notif_filter_none), modifier = Modifier.padding(top = 16.dp))
            }
        }
        section("today", R.string.v7_notif_today, today, onOpenPatient)
        section("earlier", R.string.v7_notif_earlier, earlier, onOpenPatient)
        item("end") { Box(Modifier.navigationBarsPadding()) }
    }
}

@OptIn(ExperimentalFoundationApi::class)
private fun LazyListScope.section(
    key: String,
    title: Int,
    rows: List<AlertRow>,
    onOpenPatient: (String) -> Unit,
) {
    if (rows.isEmpty()) return
    stickyHeader(key) {
        GroupHeader(stringResource(title), Modifier.glassChrome(SkTheme.palette.surface1.color))
    }
    itemsIndexed(rows, key = { _, row -> row.id }) { i, row ->
        BellRow(row, i, rows.size, Modifier.animateItem(), onOpenPatient)
    }
}

@Composable
private fun Muted(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = SkTheme.palette.onSurfaceVariant.color,
) = Text(text, style = SkTypography.footnote, color = color, modifier = modifier)

private fun BellFilter.label(): Int =
    when (this) {
        BellFilter.All -> R.string.v7_notif_filter_all
        BellFilter.Unread -> R.string.v7_notif_filter_unread
        BellFilter.Queue -> R.string.v7_notif_filter_queue
        BellFilter.Bookings -> R.string.v7_notif_filter_bookings
    }

private const val MAX = 30
private const val SIDE = 16
private const val SHEET_RADIUS = 28
private const val SCRIM = 0.32f
