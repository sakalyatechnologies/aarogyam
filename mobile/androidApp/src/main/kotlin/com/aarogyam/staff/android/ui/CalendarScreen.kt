package com.aarogyam.staff.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.calendar.CalendarColumn
import com.aarogyam.staff.calendar.CalendarEntry
import com.aarogyam.staff.calendar.CalendarMode
import com.aarogyam.staff.calendar.CalendarState
import com.aarogyam.staff.calendar.CalendarStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkDivider
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTabs
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.LocalDate
import kotlin.math.abs

private const val SWIPE_DISTANCE = 120f

/** The day view: swipe or tap the arrows between days, split by doctor or chair, tap for details. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarScreen(
    holder: CalendarStateHolder,
    onOpenPatient: (String) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    var detail by rememberSaveable { mutableStateOf<String?>(null) }
    val loaded = state as? CalendarState.Loaded
    Column(Modifier.fillMaxSize()) {
        SkTopBar(title = stringResource(R.string.calendar_title))
        if (state == CalendarState.NotAllowed) {
            SkEmptyState(
                stringResource(R.string.calendar_not_allowed_title),
                stringResource(R.string.calendar_not_allowed_message),
            )
            return@Column
        }
        DayBar(state.dayOf(), holder)
        SkTabs(
            titles = listOf(stringResource(R.string.calendar_by_doctor), stringResource(R.string.calendar_by_chair)),
            selectedIndex = if (loaded?.mode == CalendarMode.Chair) 1 else 0,
            onSelect = { holder.setMode(if (it == 0) CalendarMode.Doctor else CalendarMode.Chair) },
        )
        if (loaded != null && loaded.columns.isNotEmpty()) Columns(loaded, holder)
        PullToRefreshBox(
            isRefreshing = loaded?.refreshing == true,
            onRefresh = holder::refresh,
            modifier = Modifier.weight(1f).swipeDays(holder),
        ) {
            when (val current = state) {
                is CalendarState.Loading -> {
                    LoadingIndicator()
                }

                is CalendarState.Failed -> {
                    SkEmptyState(
                        stringResource(R.string.calendar_title),
                        stringResource(current.error.message()),
                        actionLabel = stringResource(R.string.try_again),
                        onAction = holder::refresh,
                    )
                }

                is CalendarState.Loaded -> {
                    Day(current) { detail = it.appointmentId }
                }

                CalendarState.NotAllowed -> {}
            }
        }
    }
    val entry = loaded?.entries?.firstOrNull { it.appointmentId == detail }
    if (entry != null) {
        AppointmentSheet(entry, onDismiss = { detail = null }, onOpenPatient = {
            detail = null
            onOpenPatient(entry.patientId)
        })
    }
}

private fun CalendarState.dayOf(): LocalDate? =
    when (this) {
        CalendarState.NotAllowed -> null
        is CalendarState.Loading -> date
        is CalendarState.Failed -> date
        is CalendarState.Loaded -> date
    }

/** Horizontal drags change the day: left for the next one, right for the previous. */
private fun Modifier.swipeDays(holder: CalendarStateHolder): Modifier =
    pointerInput(holder) {
        var total = 0f
        detectHorizontalDragGestures(
            onDragStart = { total = 0f },
            onDragEnd = {
                if (abs(total) > SWIPE_DISTANCE) {
                    if (total < 0) {
                        holder.next()
                    } else {
                        holder.previous()
                    }
                }
            },
            onHorizontalDrag = { _, amount -> total += amount },
        )
    }

@Composable
private fun DayBar(
    date: LocalDate?,
    holder: CalendarStateHolder,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.S.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val muted = SkTheme.colors.primaryText.color
        BarAction("‹", muted, holder::previous, stringResource(R.string.calendar_previous))
        Box(Modifier.weight(1f).clickable(onClick = holder::goToToday), contentAlignment = Alignment.Center) {
            Text(date?.dayLabel().orEmpty(), style = SkTypography.headline, color = SkTheme.colors.text.color)
        }
        BarAction("›", muted, holder::next, stringResource(R.string.calendar_next))
    }
}

@Composable
private fun Columns(
    state: CalendarState.Loaded,
    holder: CalendarStateHolder,
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = Spacing.ML.dp, vertical = Spacing.S.dp),
        horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
    ) {
        items(state.columns, key = { it.id }) { column ->
            SkChip(
                stringResource(R.string.calendar_column_count, column.name, column.count),
                tone = if (state.selected == column.id) SkTone.Brand else SkTone.Neutral,
                modifier = Modifier.clickable { holder.select(column.id) },
            )
        }
    }
}

@Composable
private fun Day(
    state: CalendarState.Loaded,
    onOpen: (CalendarEntry) -> Unit,
) {
    if (state.entries.isEmpty()) {
        SkEmptyState(stringResource(R.string.calendar_empty_title), stringResource(R.string.calendar_empty_message))
        return
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(Spacing.ML.dp)) {
        state.error?.let { error ->
            item {
                Text(
                    stringResource(error.message()),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.dangerText.color,
                )
            }
        }
        item {
            SkCard(contentPadding = 0.dp) {
                state.entries.forEachIndexed { index, entry ->
                    if (index > 0) SkDivider()
                    SkListRow(
                        title = entry.patientName,
                        subtitle = listOfNotNull(entry.starts.display(), entry.reason, entry.room).joinToString(" · "),
                        onClick = { onOpen(entry) },
                        leading = { SkAvatar(entry.patientName, tone = entry.status.tone()) },
                        trailing = { SkChip(stringResource(entry.status.label()), tone = entry.status.tone()) },
                    )
                }
            }
        }
    }
}
