package com.aarogyam.staff.android.ui.desk

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.clinic.ClinicContext

/** Front desk (T13, owned by the desk worker): lookup, board, intake, family and collect. AppRoot calls [deskDestinations]; the worker adds its routes and openers here. */
@Suppress("UNUSED_PARAMETER")
fun NavGraphBuilder.deskDestinations(
    graph: AppGraph,
    clinic: () -> ClinicContext?,
    nav: NavController,
) {
}
