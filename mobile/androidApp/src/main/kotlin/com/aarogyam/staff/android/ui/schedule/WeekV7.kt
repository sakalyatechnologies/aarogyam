package com.aarogyam.staff.android.ui.schedule

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.dayLabel
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.patient.V7Icon
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.android.ui.today.SectionHeader
import com.aarogyam.staff.schedule.WeekState
import com.aarogyam.staff.schedule.WeekStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkHeatLegend
import com.sakalya.mobile.designcompose.SkHeatmap
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.isoDayNumber
import java.time.DayOfWeek
import java.time.format.TextStyle

/** The Week view: the heat map in a card, the busiest hour from the real counts, and the open-slots preview. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WeekV7(holder: WeekStateHolder) {
    val state by holder.state.collectAsStateWithLifecycle()
    PullToRefreshBox(false, holder::refresh, Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.L.dp)
                .padding(bottom = Spacing.XXL.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        ) {
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
                    Loaded(s, holder)
                }
            }
        }
    }
}

@Composable
private fun Loaded(
    s: WeekState.Loaded,
    holder: WeekStateHolder,
) {
    val view = s.view
    val hours = view.hours.toList()
    val locale = LocalConfiguration.current.locales[0]
    val resources = LocalResources.current
    val short = view.days.map { DayOfWeek.of(it.date.dayOfWeek.isoDayNumber).getDisplayName(TextStyle.SHORT, locale) }
    val peak = maxOf(view.peak, 1)
    var picked by remember { mutableStateOf<Pair<Int, Int>?>(null) }

    fun count(
        r: Int,
        c: Int,
    ) = view.days[r].byHour[hours[c]] ?: 0

    fun describe(
        r: Int,
        c: Int,
    ) = resources.getQuantityString(
        R.plurals.v7_week_cell,
        count(r, c),
        view.days[r].date.dayLabel(),
        DayGrid.hourLabel(hours[c]),
        count(r, c),
    )
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Arrow("back", R.string.sh_s_week_prev, holder::previous)
        Text(
            s.start.dayLabel(),
            style = SkTypography.titleSmall,
            color = SkTheme.palette.onSurface.color,
            modifier = Modifier.weight(1f),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Arrow("chev", R.string.sh_s_week_next, holder::next)
    }
    if (s.walkInsFailed) {
        Text(
            stringResource(R.string.calendar_walk_ins_failed),
            style = v7(12f),
            color = SkTheme.palette.onSurfaceVariant.color,
        )
    }
    SkCard {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SkHeatmap(
                rowLabels = short,
                columnLabels = hours.map(DayGrid::hourLabel),
                loads = view.days.indices.map { r -> hours.indices.map { c -> count(r, c).toDouble() / peak } },
                selected = picked,
                onSelect = { r, c -> picked = r to c },
                describe = ::describe,
            )
            SkHeatLegend(stringResource(R.string.v7_week_quiet), stringResource(R.string.v7_week_busy))
        }
    }
    val best =
        view.days.indices
            .flatMap { r -> hours.indices.map { c -> Triple(r, c, count(r, c)) } }
            .fold(null as Triple<Int, Int, Int>?) { acc, t -> if (t.third > (acc?.third ?: 0)) t else acc }
    best?.let { SectionHeader(stringResource(R.string.sh_s_week_busiest, describe(it.first, it.second))) }
    Text(stringResource(R.string.sh_s_week_open_slots), style = v7(12f), color = SkTheme.palette.onSurfaceVariant.color)
    PreviewNotice()
}

@Composable
private fun Arrow(
    icon: String,
    label: Int,
    onClick: () -> Unit,
) {
    val description = stringResource(label)
    androidx.compose.foundation.layout.Box(
        Modifier.size(44.dp).clickable(role = Role.Button, onClick = onClick).semantics {
            contentDescription =
                description
        },
        contentAlignment = Alignment.Center,
    ) { V7Icon(icon, SkTheme.palette.onSurface.color, 20.dp) }
}
