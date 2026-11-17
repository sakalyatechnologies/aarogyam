package com.aarogyam.staff.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
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
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.patient.V7Icon
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.android.ui.schedule.BookFlow
import com.aarogyam.staff.android.ui.schedule.DayV7
import com.aarogyam.staff.android.ui.schedule.QueueV7
import com.aarogyam.staff.android.ui.schedule.WeekV7
import com.aarogyam.staff.android.ui.today.IconWell
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.schedule.ScheduleSegment
import com.aarogyam.staff.schedule.ScheduleStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkSegmented
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTransitions
import com.sakalya.mobile.designcompose.color

/** The Schedule tab: Queue, Day and Week under one segmented control, swapping with a fade-through (iOS `ScheduleTab`). */
@Composable
fun ScheduleTab(
    holder: ScheduleStateHolder,
    graph: AppGraph,
    clinic: ClinicContext,
    onWalkIn: () -> Unit,
    onOpenBoard: () -> Unit,
    onOpenPatient: (String) -> Unit,
) {
    val segment by holder.segment.collectAsStateWithLifecycle()
    var booking by rememberSaveable { mutableStateOf(false) }
    val reduced = SkTheme.reducedMotion
    // No top bar here: the segments start below the status bar.
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(
            Modifier.padding(horizontal = Spacing.L.dp, vertical = Spacing.S.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
        ) {
            SkSegmented(
                listOf(
                    stringResource(R.string.v7_schedule_queue),
                    stringResource(R.string.v7_schedule_day),
                    stringResource(R.string.v7_schedule_week),
                ),
                segment.ordinal,
                { holder.show(ScheduleSegment.entries[it]) },
                Modifier.weight(1f),
            )
            IconWell("cal", stringResource(R.string.sh_s_book_action), { booking = true })
        }
        if (segment == ScheduleSegment.Queue) BoardEntry(onOpenBoard)
        AnimatedContent(segment, transitionSpec = {
            SkTransitions.tabEnter(reduced) togetherWith SkTransitions.tabExit()
        }, label = "segment") {
            when (it) {
                ScheduleSegment.Queue -> {
                    QueueV7(
                        holder.queue,
                        onWalkIn,
                        { opened -> onOpenPatient(opened.patientId) },
                        onOpenPatient,
                    )
                }

                ScheduleSegment.Day -> {
                    DayV7(holder.day, clinic.timeZone, onOpenPatient)
                }

                ScheduleSegment.Week -> {
                    WeekV7(holder.week)
                }
            }
        }
    }
    if (booking) BookFlow(graph, clinic) { booking = false }
}

/** A row under the segmented control that opens the waiting-room board. */
@Composable
private fun BoardEntry(onOpen: () -> Unit) {
    val p = SkTheme.palette
    Row(
        Modifier
            .padding(horizontal = Spacing.L.dp)
            .padding(bottom = Spacing.S.dp)
            .fillMaxWidth()
            .background(p.card.color, CircleShape)
            .clickable(role = Role.Button, onClick = onOpen)
            .defaultMinSize(minHeight = 48.dp)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        V7Icon("users", p.primary.color, 18.dp)
        Text(
            stringResource(R.string.dk_d9_board_open),
            style = v7(14f, FontWeight.Bold),
            color = p.onSurface.color,
            modifier = Modifier.weight(1f),
        )
        V7Icon("chev", p.onSurfaceVariant.color, 16.dp)
    }
}
