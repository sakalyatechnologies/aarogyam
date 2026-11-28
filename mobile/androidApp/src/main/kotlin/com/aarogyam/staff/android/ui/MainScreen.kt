package com.aarogyam.staff.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.push.PushInbox
import com.aarogyam.staff.android.ui.clinical.ExpensesPage
import com.aarogyam.staff.android.ui.clinical.openExpenses
import com.aarogyam.staff.android.ui.desk.openDeskBoard
import com.aarogyam.staff.android.ui.patient.openPatient
import com.aarogyam.staff.android.ui.today.TodayTab
import com.aarogyam.staff.art.Icons
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.nav.NavModel
import com.aarogyam.staff.nav.PrimaryAction
import com.aarogyam.staff.nav.Tab
import com.sakalya.mobile.design.FloatingNavSizes
import com.sakalya.mobile.designcompose.SkFloatingNavBar
import com.sakalya.mobile.designcompose.SkNavAction
import com.sakalya.mobile.designcompose.SkNavDestination
import com.sakalya.mobile.designcompose.SkNavRail
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTransitions
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Windows at least this wide get the rail instead of the floating bar. */
private val RAIL_FROM = 600.dp

/**
 * The signed-in shell of the v7 design: tabs and the bar action come from [NavModel] (the role's
 * permissions), on a floating bar that hides while scrolling down, or a rail on wide windows. Tabs
 * fade through; each tab's state holder lives as long as this destination. Other areas open through [nav].
 */
@Composable
fun MainScreen(
    graph: AppGraph,
    clinic: ClinicContext,
    clinicCount: Int,
    nav: NavController,
    onWalkIn: () -> Unit,
    onSwitchClinic: () -> Unit,
) {
    val navModel = remember(clinic.permissions, clinicCount) { NavModel.of(clinic.permissions, clinicCount) }
    var tab by rememberSaveable { mutableStateOf(navModel.tabs.first()) }
    if (tab !in navModel.tabs) tab = navModel.tabs.first()
    var barVisible by remember { mutableStateOf(true) }
    val hideOnScroll = remember { BarHider { barVisible = it } }
    val items = navModel.tabs.map { SkNavDestination(it.name, stringResource(it.label), Icons.of(it.icon)) }
    val action =
        when (navModel.action) {
            PrimaryAction.WalkIn -> {
                // One "+": the one search finds or adds the patient, then checks in, books or just saves.
                SkNavAction(stringResource(R.string.v7_action_walk_in), Icons.of("plus"), onWalkIn)
            }

            PrimaryAction.AddExpense -> {
                SkNavAction(
                    stringResource(R.string.v7_action_add_expense),
                    Icons.of("wallet"),
                    nav::openExpenses,
                )
            }

            null -> {
                null
            }
        }
    val reduced = SkTheme.reducedMotion
    val select = { key: String ->
        tab = Tab.valueOf(key)
        barVisible = true
    }
    // The logo: the Today tab (else the first), its screens back at their start.
    var homeResets by rememberSaveable { mutableStateOf(0) }
    val goHome: () -> Unit = {
        select((if (Tab.Today in navModel.tabs) Tab.Today else navModel.tabs.first()).name)
        homeResets++
    }
    // A tapped Today or Tasks alert selects the Today tab.
    val showToday by PushInbox.showToday.collectAsStateWithLifecycle()
    LaunchedEffect(showToday) {
        if (showToday) {
            PushInbox.requestToday(false)
            if (Tab.Today in navModel.tabs) select(Tab.Today.name)
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= RAIL_FROM
        Row(Modifier.fillMaxSize()) {
            if (wide) SkNavRail(items, tab.name, select, action = action)
            Box(Modifier.weight(1f).nestedScroll(hideOnScroll)) {
                Column(Modifier.fillMaxSize()) {
                    BrandBar(goHome)
                    Box(Modifier.weight(1f).consumeWindowInsets(WindowInsets.statusBars)) {
                        AnimatedContent(
                            targetState = tab,
                            transitionSpec = { SkTransitions.tabEnter(reduced) togetherWith SkTransitions.tabExit() },
                            label = "tab",
                        ) { shown ->
                            key(homeResets) {
                                TabContent(
                                    shown,
                                    navModel,
                                    graph,
                                    clinic,
                                    nav,
                                    onWalkIn,
                                    onSwitchClinic,
                                ) { select(it.name) }
                            }
                        }
                    }
                }
                if (!wide) {
                    SkFloatingNavBar(
                        items,
                        tab.name,
                        select,
                        Modifier.align(Alignment.BottomCenter),
                        action = action,
                        visible = barVisible,
                    )
                }
            }
        }
    }
}

@Composable
private fun TabContent(
    tab: Tab,
    navModel: NavModel,
    graph: AppGraph,
    clinic: ClinicContext,
    nav: NavController,
    onWalkIn: () -> Unit,
    onSwitchClinic: () -> Unit,
    onTab: (Tab) -> Unit,
) {
    val onOpenPatient: (String) -> Unit = { nav.openPatient(it) }
    when (tab) {
        Tab.Today -> {
            TodayTab(
                graph,
                clinic,
                nav,
                onOpenPatient,
                onOpenSchedule = { onTab(Tab.Schedule) },
                onAddExpense = nav::openExpenses,
                onWalkIn = onWalkIn,
            )
        }

        Tab.Patients -> {
            PatientsScreen(rememberHolder { graph.patients(clinic, it) }, onOpenPatient, onWalkIn)
        }

        Tab.Schedule -> {
            ScheduleTab(
                rememberHolder { graph.schedule(clinic, it) },
                graph,
                clinic,
                onWalkIn,
                nav::openDeskBoard,
                onOpenPatient,
            )
        }

        Tab.Expenses -> {
            ExpensesPage(graph, clinic, showsAdd = false)
        }

        Tab.More -> {
            MoreScreen(graph, clinic, navModel, nav, onSwitchClinic)
        }
    }
}

/** Hides the floating bar while the content scrolls down past the threshold, and shows it on any scroll up. */
private class BarHider(
    private val show: (Boolean) -> Unit,
) : NestedScrollConnection {
    private var travelled = 0f

    override fun onPreScroll(
        available: Offset,
        source: NestedScrollSource,
    ): Offset {
        if (available.y > 0) {
            travelled = 0f
            show(true)
        } else if (available.y < 0) {
            travelled -= available.y
            if (travelled > FloatingNavSizes.HIDE_AFTER) show(false)
        }
        return Offset.Zero
    }
}

private val Tab.label: Int
    get() =
        when (this) {
            Tab.Today -> R.string.tab_today
            Tab.Patients -> R.string.tab_patients
            Tab.Schedule -> R.string.v7_tab_schedule
            Tab.Expenses -> R.string.v7_tab_expenses
            Tab.More -> R.string.v7_tab_more
        }

/** The mockup's tab icons (TABDEF): home, users, cal, wallet for finance's Expenses, grid. */
private val Tab.icon: String
    get() =
        when (this) {
            Tab.Today -> "home"
            Tab.Patients -> "users"
            Tab.Schedule -> "cal"
            Tab.Expenses -> "wallet"
            Tab.More -> "grid"
        }

/** The app logo and name at the top left of every main screen, under the status bar; a tap goes home. */
@Composable
private fun BrandBar(onHome: () -> Unit) {
    val brand = stringResource(R.string.app_name)
    Row(
        Modifier
            .fillMaxWidth()
            .background(SkTheme.colors.background.color)
            .statusBarsPadding()
            .clickable(role = Role.Button, onClick = onHome)
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .semantics(mergeDescendants = true) { contentDescription = brand },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BrandGlyph(LOGO)
        Text(brand, style = SkTypography.headline, color = SkTheme.colors.text.color)
    }
}

private const val LOGO = 28
