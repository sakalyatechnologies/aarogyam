package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.designcompose.SkBottomNavigation
import com.sakalya.mobile.designcompose.SkNavItem

private const val TAB_TODAY = 0
private const val TAB_PATIENTS = 1
private const val TAB_CALENDAR = 2

/**
 * The signed-in shell: Today, Patients and Calendar behind bottom tabs. Each tab's state holder
 * lives as long as this destination, so a search or a day survives a tab switch.
 */
@Composable
fun MainScreen(
    graph: AppGraph,
    clinic: ClinicContext,
    onOpenPatient: (String) -> Unit,
    onSwitchClinic: () -> Unit,
    onSignOut: () -> Unit,
) {
    var tab by rememberSaveable { mutableIntStateOf(TAB_TODAY) }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            when (tab) {
                TAB_PATIENTS -> PatientsScreen(rememberHolder { graph.patients(clinic, it) }, onOpenPatient)
                TAB_CALENDAR -> CalendarScreen(rememberHolder { graph.calendar(clinic, it) }, onOpenPatient)
                else -> TodayScreen(rememberHolder { graph.today(clinic, it) }, onSwitchClinic, onSignOut)
            }
        }
        SkBottomNavigation(
            items =
                listOf(
                    navItem(R.string.tab_today, R.drawable.ic_tab_today),
                    navItem(R.string.tab_patients, R.drawable.ic_tab_patients),
                    navItem(R.string.tab_calendar, R.drawable.ic_tab_calendar),
                ),
            selectedIndex = tab,
            onSelect = { tab = it },
        )
    }
}

@Composable
private fun navItem(
    label: Int,
    icon: Int,
) = SkNavItem(stringResource(label)) { Icon(painterResource(icon), contentDescription = null) }
