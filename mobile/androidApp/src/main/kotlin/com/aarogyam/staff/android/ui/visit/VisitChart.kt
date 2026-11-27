package com.aarogyam.staff.android.ui.visit

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.ui.patient.JawCard
import com.aarogyam.staff.android.ui.patient.ToothSheet
import com.aarogyam.staff.chart.ChartState
import com.aarogyam.staff.chart.ChartStateHolder
import com.aarogyam.staff.clinic.ClinicContext

/** Start treatment opens on the full chart: tap a tooth for the same sheet the patient page has. */
@Composable
internal fun VisitChart(
    graph: AppGraph,
    clinic: ClinicContext,
    chart: ChartStateHolder,
    state: ChartState,
    visitId: String,
) {
    var open by remember { mutableStateOf(false) }
    var dictate by remember { mutableStateOf(false) }
    JawCard(state, chart, {
        chart.select(it, null)
        dictate = false
        open = true
    }) {
        chart.select(it, null)
        dictate = true
        open = true
    }
    val loaded = state as? ChartState.Loaded
    val selection = loaded?.selected
    if (open && loaded != null && selection != null) {
        ToothSheet(graph, clinic, chart, loaded, selection, dictate, visitId) {
            open = false
            chart.clearSelection()
        }
    }
}
