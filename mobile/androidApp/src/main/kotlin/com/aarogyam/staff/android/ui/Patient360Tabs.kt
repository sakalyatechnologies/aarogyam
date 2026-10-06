package com.aarogyam.staff.android.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.chart.ChartTab
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.designcompose.SkEmptyState

/** Patient 360's tabs, in order. A new tab is one entry here and one branch in [PatientTabContent]. */
enum class PatientTab(
    @StringRes val title: Int,
) {
    Overview(R.string.patient_tab_overview),
    Chart(R.string.patient_tab_chart),
    Rx(R.string.patient_tab_rx),
    Billing(R.string.patient_tab_billing),
}

/**
 * One tab's content. Each tab's state holder lives as long as the patient's screen, so a tab
 * switch keeps what was loaded. Overview is drawn by [Patient360Screen] itself.
 */
@Composable
fun PatientTabContent(
    tab: PatientTab,
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
) {
    when (tab) {
        PatientTab.Overview -> Unit
        PatientTab.Chart -> ChartTab(rememberHolder { graph.chart(clinic, patientId, it) })
        PatientTab.Rx -> ComingSoon(tab)
        PatientTab.Billing -> ComingSoon(tab)
    }
}

@Composable
private fun ComingSoon(tab: PatientTab) =
    SkEmptyState(stringResource(tab.title), stringResource(R.string.patient_tab_coming))
