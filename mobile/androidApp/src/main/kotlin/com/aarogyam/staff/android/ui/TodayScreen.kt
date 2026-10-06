package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.today.DayPart
import com.aarogyam.staff.today.HeroKind
import com.aarogyam.staff.today.ScheduleItem
import com.aarogyam.staff.today.TodayState
import com.aarogyam.staff.today.TodayStateHolder
import com.aarogyam.staff.today.TodayView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkDivider
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkHeroCard
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkStatTile
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Today at the clinic, as in the mock-up: greeting, day tiles, who is next, the schedule. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    holder: TodayStateHolder,
    onSwitchClinic: () -> Unit,
    onSignOut: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val loaded = state as? TodayState.Loaded
    Column(Modifier.fillMaxSize()) {
        SkTopBar(
            title = stringResource(R.string.app_name),
            subtitle = loaded?.view?.let { greeting(it) },
            actions = {
                val onBar = SkTheme.colors.onBrandDark.color
                BarAction(stringResource(R.string.switch_clinic), onBar, onSwitchClinic)
                BarAction(stringResource(R.string.sign_out), onBar, onSignOut)
            },
        )
        PullToRefreshBox(
            isRefreshing = loaded?.refreshing == true,
            onRefresh = holder::refresh,
            modifier = Modifier.weight(1f).navigationBarsPadding(),
        ) {
            when (val current = state) {
                TodayState.Loading -> {
                    LoadingIndicator()
                }

                TodayState.NotAllowed -> {
                    SkEmptyState(
                        stringResource(R.string.today_not_allowed_title),
                        stringResource(R.string.today_not_allowed_message),
                    )
                }

                is TodayState.Failed -> {
                    SkEmptyState(
                        stringResource(R.string.today_title),
                        stringResource(current.error.message()),
                        actionLabel = stringResource(R.string.try_again),
                        onAction = holder::refresh,
                    )
                }

                is TodayState.Loaded -> {
                    TodayContent(current)
                }
            }
        }
    }
}

@Composable
private fun greeting(view: TodayView): String =
    stringResource(
        when (view.dayPart) {
            DayPart.Morning -> R.string.greeting_morning
            DayPart.Afternoon -> R.string.greeting_afternoon
            DayPart.Evening -> R.string.greeting_evening
        },
        view.memberName,
        view.clinicName,
    )

@Composable
private fun TodayContent(state: TodayState.Loaded) {
    val view = state.view
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = Spacing.ML.dp)) {
        state.error?.let { error ->
            item {
                Text(
                    stringResource(error.message()),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.dangerText.color,
                    modifier = Modifier.padding(horizontal = Spacing.L.dp, vertical = Spacing.XS.dp),
                )
            }
        }
        item {
            Row(
                Modifier.padding(horizontal = Spacing.ML.dp),
                horizontalArrangement = Arrangement.spacedBy(Spacing.M.dp),
            ) {
                SkStatTile(view.counts.visits.toString(), stringResource(R.string.stat_visits), Modifier.weight(1f))
                SkStatTile(view.counts.waiting.toString(), stringResource(R.string.stat_waiting), Modifier.weight(1f))
                SkStatTile(view.counts.done.toString(), stringResource(R.string.stat_done), Modifier.weight(1f))
            }
        }
        val hero = view.hero
        if (hero != null) {
            item {
                val kicker = if (view.heroKind == HeroKind.Now) R.string.hero_now else R.string.hero_next
                SkHeroCard(
                    kicker = stringResource(kicker, hero.starts.display()),
                    title = hero.patientName,
                    subtitle = detail(hero),
                    modifier = Modifier.padding(horizontal = Spacing.ML.dp, vertical = Spacing.ML.dp),
                )
            }
        }
        item { Schedule(view.schedule) }
    }
}

@Composable
private fun Schedule(items: List<ScheduleItem>) {
    if (items.isEmpty()) {
        SkEmptyState(stringResource(R.string.schedule_empty_title), stringResource(R.string.schedule_empty_message))
        return
    }
    SkCard(Modifier.padding(horizontal = Spacing.ML.dp)) {
        Text(
            stringResource(R.string.schedule),
            style = SkTypography.headline,
            color = SkTheme.colors.text.color,
            modifier = Modifier.padding(bottom = Spacing.SM.dp),
        )
        items.forEachIndexed { index, item ->
            if (index > 0) SkDivider()
            SkListRow(
                title = item.patientName,
                subtitle = listOfNotNull(item.starts.display(), item.reason).joinToString(" · "),
                leading = { SkAvatar(item.patientName, tone = item.status.tone()) },
                trailing = { SkChip(stringResource(item.status.label()).uppercase(), tone = item.status.tone()) },
            )
        }
    }
}

private fun detail(item: ScheduleItem): String =
    listOfNotNull(item.reason, item.room, item.patientNumber).joinToString(" · ")
