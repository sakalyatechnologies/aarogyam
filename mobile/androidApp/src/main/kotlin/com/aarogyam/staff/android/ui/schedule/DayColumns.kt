package com.aarogyam.staff.android.ui.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.calendar.CalendarEntry
import com.aarogyam.staff.calendar.CalendarMode
import com.aarogyam.staff.calendar.CalendarState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock

private const val LABEL_WIDTH = 34
private const val HEAD = 22
private const val NARROW = 112
private const val FEW = 3

private class Col(
    val name: String,
    val entries: List<CalendarEntry>,
)

private fun columns(
    s: CalendarState.Loaded,
    unassigned: String,
): List<Col> {
    val byDoctor = s.mode == CalendarMode.Doctor
    val result =
        s.columns
            .map { c ->
                Col(
                    c.name,
                    s.entries.filter {
                        (if (byDoctor) it.practitionerId else it.roomId) ==
                            c.id
                    },
                )
            }.toMutableList()
    val placed = result.flatMap { c -> c.entries.map { it.appointmentId } }.toSet()
    val rest = s.entries.filter { it.appointmentId !in placed }
    if (rest.isNotEmpty()) result.add(Col(unassigned, rest))
    return result.filter { it.entries.isNotEmpty() || (s.selected == null && result.size <= FEW) }
}

/** Doctors or chairs as columns down the clinic hours, appointments as blocks (`.cgrid`). */
@Composable
internal fun DayColumns(
    s: CalendarState.Loaded,
    zone: TimeZone,
    onSelect: (CalendarEntry) -> Unit,
) {
    val cols = columns(s, stringResource(R.string.sh_s_day_unassigned))
    val hours = DayGrid.hours(s.entries.map { it.starts.minuteOfDay() }, s.entries.map { it.ends.minuteOfDay() })
    val few = cols.size <= FEW
    val grid: @Composable () -> Unit = {
        Box {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
                HourLabels(hours)
                cols.forEach { c ->
                    Column(if (few) Modifier.weight(1f) else Modifier.width(NARROW.dp)) { Column(c, hours, onSelect) }
                }
            }
            if (s.isToday) NowLine(hours, zone)
        }
    }
    if (few) grid() else Box(Modifier.horizontalScroll(rememberScrollState())) { grid() }
}

private fun kotlinx.datetime.LocalTime.minuteOfDay() = hour * 60 + minute

@Composable
private fun NowLine(
    hours: IntRange,
    zone: TimeZone,
) {
    val now =
        Clock.System
            .now()
            .toLocalDateTime(zone)
            .time
    val y = DayGrid.nowOffset(now.minuteOfDay(), hours) ?: return
    val red = SkTheme.palette.error.color
    Box(Modifier.fillMaxWidth().offset(y = (y + HEAD).dp)) {
        Box(
            Modifier
                .padding(start = LABEL_WIDTH.dp)
                .fillMaxWidth()
                .height(2.dp)
                .background(red),
        )
        Box(Modifier.offset(x = (LABEL_WIDTH - 4).dp, y = (-3.5).dp).size(9.dp).background(red, CircleShape))
    }
}

@Composable
private fun HourLabels(hours: IntRange) {
    val p = SkTheme.palette
    Column(Modifier.width(LABEL_WIDTH.dp)) {
        Box(Modifier.height(HEAD.dp))
        hours.forEach { h ->
            Box(Modifier.height(DayGrid.HOUR_HEIGHT.dp).fillMaxWidth()) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(p.outline.color))
                Text(
                    DayGrid.hourLabel(h),
                    style = v7(10f, FontWeight.SemiBold).copy(fontFamily = FontFamily.Monospace),
                    color = p.onSurfaceVariant.color,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun Column(
    col: Col,
    hours: IntRange,
    onSelect: (CalendarEntry) -> Unit,
) {
    val p = SkTheme.palette
    Text(
        col.name.uppercase(),
        style = v7(10.5f, FontWeight.Bold).copy(fontFamily = FontFamily.Monospace, letterSpacing = 0.4.sp),
        color = p.onSurfaceVariant.color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.height(HEAD.dp),
    )
    BoxWithConstraints(Modifier.fillMaxWidth().height((DayGrid.HOUR_HEIGHT * hours.count()).dp)) {
        Column(Modifier.fillMaxSize()) {
            hours.forEach { _ ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(
                            DayGrid.HOUR_HEIGHT.dp,
                        ).background(androidx.compose.ui.graphics.Color.Transparent),
                ) {
                    Box(Modifier.fillMaxWidth().height(1.dp).background(p.outline.color))
                }
            }
        }
        val lanes = DayGrid.lanes(col.entries.map { it.starts.minuteOfDay() to it.ends.minuteOfDay() })
        col.entries.forEachIndexed { i, e ->
            val (top, height) = DayGrid.frame(e.starts.minuteOfDay(), e.ends.minuteOfDay(), hours.first)
            val lane = lanes[i]
            val width = maxWidth / lane.count
            Block(
                e,
                Modifier
                    .width(
                        width -
                            if (lane.count >
                                1
                            ) {
                                2.dp
                            } else {
                                0.dp
                            },
                    ).height(height.dp)
                    .offset(width * lane.lane, top.dp),
            ) { onSelect(e) }
        }
    }
}

@Composable
private fun Block(
    e: CalendarEntry,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val p = SkTheme.palette
    val (bg, ink) =
        when (DayGrid.tone(e.status)) {
            DayGrid.Tone.Normal -> p.primaryContainer to p.onPrimaryContainer
            DayGrid.Tone.Warm -> p.tertiaryContainer to p.onTertiaryContainer
            DayGrid.Tone.Finished -> p.surface3 to p.onSurfaceVariant
        }
    Column(
        modifier
            .background(bg.color, RoundedCornerShape(12.dp))
            .then(if (e.walkIn) Modifier.dashedOutline(ink.color) else Modifier)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 7.dp, vertical = 6.dp),
    ) {
        if (e.walkIn) {
            Text(
                stringResource(R.string.calendar_walk_in).uppercase(),
                style = v7(9.5f, FontWeight.ExtraBold).copy(letterSpacing = 0.4.sp),
                color = ink.color,
                maxLines = 1,
            )
        }
        Text(
            e.patientName,
            style = v7(11.5f, FontWeight.Bold),
            color = ink.color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        e.reason?.let { Text(it, style = v7(11f), color = ink.color, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
}

/** The dashed edge that tells a walk-in from an appointment. */
private fun Modifier.dashedOutline(color: androidx.compose.ui.graphics.Color): Modifier =
    drawBehind {
        val radius = 12.dp.toPx()
        drawRoundRect(
            color = color.copy(alpha = 0.7f),
            cornerRadius = CornerRadius(radius),
            style =
                Stroke(
                    width = 1.5.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx())),
                ),
        )
    }
