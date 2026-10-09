package com.aarogyam.staff.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.walkin.QueueScreen
import com.aarogyam.staff.schedule.ScheduleSegment
import com.aarogyam.staff.schedule.ScheduleStateHolder
import com.aarogyam.staff.schedule.WeekState
import com.aarogyam.staff.schedule.WeekStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkHeatLegend
import com.sakalya.mobile.designcompose.SkHeatmap
import com.sakalya.mobile.designcompose.SkSegmented
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTransitions
import kotlinx.datetime.isoDayNumber
import java.time.format.TextStyle

/** The Schedule tab: Queue, Day and Week under one segmented control, swapping with a fade-through. */
@Composable
fun ScheduleTab(
    holder: ScheduleStateHolder,
    onWalkIn: () -> Unit,
    onOpenPatient: (String) -> Unit,
) {
    val segment by holder.segment.collectAsStateWithLifecycle()
    val reduced = SkTheme.reducedMotion
    Column(Modifier.fillMaxSize()) {
        SkSegmented(
            listOf(
                stringResource(R.string.v7_schedule_queue),
                stringResource(R.string.v7_schedule_day),
                stringResource(R.string.v7_schedule_week),
            ),
            segment.ordinal,
            { holder.show(ScheduleSegment.entries[it]) },
            Modifier.padding(horizontal = Spacing.L.dp, vertical = Spacing.S.dp),
        )
        AnimatedContent(segment, transitionSpec = {
            SkTransitions.tabEnter(reduced) togetherWith SkTransitions.tabExit()
        }, label = "segment") {
            when (it) {
                ScheduleSegment.Queue -> {
                    QueueScreen(
                        holder.queue,
                        onWalkIn,
                    ) { opened -> onOpenPatient(opened.patientId) }
                }

                ScheduleSegment.Day -> {
                    CalendarScreen(holder.day, onOpenPatient)
                }

                ScheduleSegment.Week -> {
                    WeekView(holder.week)
                }
            }
        }
    }
}

/** The week heat map: rows are days, columns the clinic's hours, darker for busier. */
@Composable
private fun WeekView(holder: WeekStateHolder) {
    val state by holder.state.collectAsStateWithLifecycle()
    when (val s = state) {
        WeekState.Loading -> {
            LoadingIndicator()
        }

        WeekState.NotAllowed -> {
            SkEmptyState(
                stringResource(R.string.today_not_allowed_title),
                stringResource(R.string.today_not_allowed_message),
            )
        }

        is WeekState.Failed -> {
            SkEmptyState(
                stringResource(R.string.v7_schedule_week),
                stringResource(s.error.message()),
                actionLabel = stringResource(R.string.try_again),
                onAction = holder::refresh,
            )
        }

        is WeekState.Loaded -> {
            val view = s.view
            val hours = view.hours.toList()
            val locale = LocalConfiguration.current.locales[0]
            val names =
                view.days.map {
                    java.time.DayOfWeek
                        .of(it.date.dayOfWeek.isoDayNumber)
                        .getDisplayName(TextStyle.SHORT, locale)
                }
            val resources = LocalResources.current
            Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = Spacing.L.dp)) {
                SkHeatmap(
                    rowLabels = names,
                    columnLabels = hours.map { (if (it > 12) it - 12 else it).toString() },
                    loads =
                        view.days.map { d ->
                            hours.map { h ->
                                if (view.peak ==
                                    0
                                ) {
                                    0.0
                                } else {
                                    (d.byHour[h] ?: 0).toDouble() / view.peak
                                }
                            }
                        },
                    selected = null,
                    onSelect = { _, _ -> },
                    describe = { r, c ->
                        val n = view.days[r].byHour[hours[c]] ?: 0
                        resources.getQuantityString(R.plurals.v7_week_cell, n, names[r], hours[c].toString(), n)
                    },
                )
                SkHeatLegend(
                    stringResource(R.string.v7_week_quiet),
                    stringResource(R.string.v7_week_busy),
                    Modifier.padding(top = Spacing.M.dp),
                )
            }
        }
    }
}
