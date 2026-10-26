package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.today.AttentionList
import com.aarogyam.staff.android.ui.today.IconWell
import com.aarogyam.staff.android.ui.today.MePager
import com.aarogyam.staff.android.ui.today.MoneyCards
import com.aarogyam.staff.android.ui.today.ScheduleList
import com.aarogyam.staff.android.ui.today.SectionHeader
import com.aarogyam.staff.android.ui.today.TodayHero
import com.aarogyam.staff.android.ui.today.TodayStats
import com.aarogyam.staff.android.ui.today.UpNextCarousel
import com.aarogyam.staff.today.MoneyView
import com.aarogyam.staff.today.TodayState
import com.aarogyam.staff.today.TodayStateHolder
import com.aarogyam.staff.today.TodayView
import com.sakalya.mobile.design.BarScroll
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkCollapsingTopBar
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import com.sakalya.mobile.designcompose.skStaggerIn

/** Today in the v7 design: me card and My schedule, the day's numbers, who is next, the schedule. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    holder: TodayStateHolder,
    roleName: String,
    avatar: String,
    onOpenPatient: (String) -> Unit,
    onOpenSchedule: () -> Unit,
    onAddExpense: (() -> Unit)?,
    onEditAvatar: () -> Unit,
    onQr: () -> Unit,
    onNotifications: () -> Unit,
    unread: Boolean,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val list = rememberLazyListState()
    val collapsed by remember {
        derivedStateOf {
            list.firstVisibleItemIndex > 0 ||
                BarScroll.collapsed(list.firstVisibleItemScrollOffset.toDouble())
        }
    }
    val loaded = state as? TodayState.Loaded
    val money = state as? TodayState.MoneyOnly
    Column(Modifier.fillMaxSize()) {
        SkCollapsingTopBar(
            title = stringResource(if (money != null) R.string.v7_money_today else R.string.tab_today),
            collapsed = collapsed,
            kicker = loaded?.view?.let { "${it.date.longDay()} · ${it.clinicName}" },
            actions = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (money == null) IconWell("qr", stringResource(R.string.v7_tile_clinic_qr), onQr)
                    IconWell("bell", stringResource(R.string.v7_notifications), onNotifications, badge = unread)
                }
            },
        )
        PullToRefreshBox(
            isRefreshing = loaded?.refreshing == true || money?.refreshing == true,
            onRefresh = holder::refresh,
            modifier = Modifier.weight(1f),
        ) {
            when (val s = state) {
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
                        stringResource(s.error.message()),
                        actionLabel = stringResource(R.string.try_again),
                        onAction = holder::refresh,
                    )
                }

                is TodayState.MoneyOnly -> {
                    MoneyToday(s.money, onAddExpense)
                }

                is TodayState.Loaded -> {
                    DayList(
                        s,
                        list,
                        roleName,
                        avatar,
                        onOpenPatient,
                        onOpenSchedule,
                        onAddExpense,
                        onEditAvatar,
                    )
                }
            }
        }
    }
}

@Composable
private fun DayList(
    state: TodayState.Loaded,
    list: androidx.compose.foundation.lazy.LazyListState,
    roleName: String,
    avatar: String,
    onOpenPatient: (String) -> Unit,
    onOpenSchedule: () -> Unit,
    onAddExpense: (() -> Unit)?,
    onEditAvatar: () -> Unit,
) {
    val view: TodayView = state.view
    LazyColumn(
        Modifier.fillMaxSize(),
        list,
        contentPadding = PaddingValues(bottom = BOTTOM.dp),
    ) {
        state.error?.let { error ->
            item {
                Text(
                    stringResource(error.message()),
                    style = SkTypography.footnote,
                    color = SkTheme.palette.error.color,
                    modifier = Modifier.padding(vertical = 4.dp),
                )
            }
        }
        view.me?.let { me ->
            item("me") {
                Box(Modifier.padding(horizontal = Spacing.L.dp).skStaggerIn(0)) {
                    MePager(
                        me,
                        roleName,
                        avatar,
                        view.date,
                        view.counts.waiting,
                        onEditAvatar,
                    ) { onOpenPatient(it.patientId) }
                }
            }
        }
        item("stats") { Box(Modifier.padding(horizontal = Spacing.L.dp).skStaggerIn(1)) { TodayStats(view.counts) } }
        val hero = view.hero
        val kind = view.heroKind
        if (hero != null && kind != null) {
            item("hero") {
                Box(Modifier.padding(horizontal = Spacing.L.dp).skStaggerIn(2)) {
                    TodayHero(
                        kind,
                        hero,
                        view.progress,
                        view.counts.done,
                        view.counts.visits,
                        { onOpenPatient(hero.patientId) },
                        null,
                    )
                }
            }
        }
        view.money?.let { m ->
            item(
                "money",
            ) { Box(Modifier.padding(horizontal = Spacing.L.dp).skStaggerIn(3)) { MoneyCards(m, onAddExpense) } }
        }
        val upNext = view.schedule.filter { it != hero && it.status in UPCOMING }.take(UP_NEXT)
        if (upNext.isNotEmpty()) {
            item("upnext-h") {
                Side {
                    SectionHeader(
                        stringResource(R.string.v7_up_next),
                        stringResource(R.string.v7_up_next_all, view.counts.visits),
                        onOpenSchedule,
                    )
                }
            }
            item("upnext") {
                UpNextCarousel(upNext) { onOpenPatient(it.patientId) }
            }
        }
        item("schedule-h") { Side { SectionHeader(stringResource(R.string.schedule)) } }
        if (view.schedule.isEmpty()) {
            item("schedule-empty") {
                SkEmptyState(
                    stringResource(R.string.schedule_empty_title),
                    stringResource(R.string.schedule_empty_message),
                )
            }
        } else {
            item("schedule") { Side { ScheduleList(view.schedule) { onOpenPatient(it.patientId) } } }
        }
        if (view.attention.isNotEmpty()) {
            item("attention-h") { Side { SectionHeader(stringResource(R.string.v7_needs_attention)) } }
            item("attention") { Side { AttentionList(view.attention) { onOpenPatient(it.patientId) } } }
        }
    }
}

/** The screen's side margin for rows that do not bleed to the edge. */
@Composable
private fun Side(content: @Composable () -> Unit) {
    Box(Modifier.padding(horizontal = Spacing.L.dp)) { content() }
}

/** Finance's Today: the money first (the full v7 money page comes with analytics). */
@Composable
private fun MoneyToday(
    money: MoneyView,
    onAddExpense: (() -> Unit)?,
) {
    Column(Modifier.padding(horizontal = Spacing.L.dp)) { MoneyCards(money, onAddExpense) }
}

private fun kotlinx.datetime.LocalDate.longDay(): String {
    val d = java.time.LocalDate.of(year, month.ordinal + 1, day)
    return d.format(
        java.time.format.DateTimeFormatter
            .ofPattern("EEEE d MMMM"),
    )
}

private val UPCOMING =
    setOf(
        com.aarogyam.staff.today.VisitStatus.Booked,
        com.aarogyam.staff.today.VisitStatus.Confirmed,
        com.aarogyam.staff.today.VisitStatus.Arrived,
    )
private const val UP_NEXT = 4
private const val BOTTOM = 110
