package com.aarogyam.staff.android.ui.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.AppointmentSheet
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.calendar.CalendarMode
import com.aarogyam.staff.calendar.CalendarState
import com.aarogyam.staff.calendar.CalendarStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkSegmented
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlin.math.abs

private const val SWIPE = 100f

/** The Day view: a week strip, doctors or chairs side by side down the hours, the "now" line, tap for details. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DayV7(
    holder: CalendarStateHolder,
    zone: TimeZone,
    onOpenPatient: (String) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    var detail by rememberSaveable { mutableStateOf<String?>(null) }
    val loaded = state as? CalendarState.Loaded
    PullToRefreshBox(loaded?.refreshing == true, holder::refresh, Modifier.fillMaxSize().swipeDays(holder)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.L.dp)
                .padding(bottom = Spacing.XXL.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            when (val s = state) {
                CalendarState.NotAllowed -> {
                    SkEmptyState(
                        stringResource(R.string.calendar_not_allowed_title),
                        stringResource(R.string.calendar_not_allowed_message),
                    )
                }

                is CalendarState.Loading -> {
                    LoadingIndicator()
                }

                is CalendarState.Failed -> {
                    SkEmptyState(
                        stringResource(R.string.calendar_title),
                        stringResource(s.error.message()),
                        actionLabel = stringResource(R.string.try_again),
                        onAction = holder::refresh,
                    )
                }

                is CalendarState.Loaded -> {
                    Day(s, holder, zone) { detail = it }
                }
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

@Composable
private fun Day(
    s: CalendarState.Loaded,
    holder: CalendarStateHolder,
    zone: TimeZone,
    onDetail: (String) -> Unit,
) {
    DayStrip(s.date, holder::show)
    SkSegmented(
        listOf(stringResource(R.string.calendar_by_doctor), stringResource(R.string.calendar_by_chair)),
        if (s.mode == CalendarMode.Chair) 1 else 0,
        { holder.setMode(if (it == 0) CalendarMode.Doctor else CalendarMode.Chair) },
    )
    s.error?.let { Text(stringResource(it.message()), style = v7(12f), color = SkTheme.palette.error.color) }
    if (s.entries.isEmpty()) {
        SkEmptyState(stringResource(R.string.calendar_empty_title), stringResource(R.string.calendar_empty_message))
    } else {
        DayColumns(s, zone) { onDetail(it.appointmentId) }
    }
}

@Composable
private fun DayStrip(
    date: LocalDate,
    onPick: (LocalDate) -> Unit,
) {
    val p = SkTheme.palette
    val locale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        DayGrid.week(date).forEach { day ->
            val on = day == date
            val name =
                java.time.DayOfWeek
                    .of(day.dayOfWeek.ordinal + 1)
                    .getDisplayName(java.time.format.TextStyle.SHORT, locale)
            Column(
                Modifier
                    .width(52.dp)
                    .padding(top = if (on) 0.dp else 2.dp, bottom = if (on) 2.dp else 0.dp)
                    .background((if (on) p.primary else p.surface2).color, RoundedCornerShape(18.dp))
                    .clickable(role = Role.Button) { onPick(day) }
                    .semantics { selected = on }
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    name,
                    style = v7(11.5f, FontWeight.Bold),
                    color = (if (on) p.onPrimary else p.onSurfaceVariant).color,
                )
                Text(
                    day.day.toString(),
                    style = v7(18f, FontWeight.ExtraBold),
                    color = (if (on) p.onPrimary else p.onSurface).color,
                )
            }
        }
    }
}

/** Left for the next day, right for the previous one; mostly-vertical drags are left to scrolling. */
private fun Modifier.swipeDays(holder: CalendarStateHolder): Modifier =
    pointerInput(holder) {
        var total = 0f
        detectHorizontalDragGestures(
            onDragStart = { total = 0f },
            onDragEnd = {
                if (abs(total) > SWIPE) {
                    if (total < 0) holder.next() else holder.previous()
                }
            },
            onHorizontalDrag = { _, amount -> total += amount },
        )
    }
