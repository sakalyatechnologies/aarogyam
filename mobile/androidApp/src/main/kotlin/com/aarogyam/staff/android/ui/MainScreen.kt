package com.aarogyam.staff.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
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
    var plusOpen by remember { mutableStateOf(false) }
    val plus = PlusChoices.of(clinic.permissions)
    val action =
        when (navModel.action) {
            PrimaryAction.WalkIn -> {
                val open = if (plus.size > 1) ({ plusOpen = true }) else onWalkIn
                SkNavAction(stringResource(R.string.v7_action_walk_in), Icons.of("plus"), open)
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
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= RAIL_FROM
        PlusMenu(plusOpen, plus, graph, clinic, nav, onWalkIn, { plusOpen = false }, wide)
        Row(Modifier.fillMaxSize()) {
            if (wide) SkNavRail(items, tab.name, select, action = action)
            Box(Modifier.weight(1f).nestedScroll(hideOnScroll)) {
                AnimatedContent(
                    targetState = tab,
                    transitionSpec = { SkTransitions.tabEnter(reduced) togetherWith SkTransitions.tabExit() },
                    label = "tab",
                ) { shown ->
                    TabContent(shown, navModel, graph, clinic, nav, onWalkIn, onSwitchClinic) { select(it.name) }
                }
                // Today and More are light pages with no top bar: scrolled content stops at the status bar.
                if (tab in LIGHT_TOP) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .windowInsetsTopHeight(WindowInsets.statusBars)
                            .background(SkTheme.colors.background.color),
                    )
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

/** Tabs whose page runs up to the status bar without a dark header of its own. */
private val LIGHT_TOP = setOf(Tab.Today, Tab.More)
