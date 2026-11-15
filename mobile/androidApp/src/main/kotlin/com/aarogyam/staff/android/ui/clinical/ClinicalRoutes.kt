package com.aarogyam.staff.android.ui.clinical

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.clinic.ClinicContext

/** Labs, team chat and the More extras (T13, owned by the clinical worker). AppRoot calls [clinicalDestinations]; the worker adds its routes and openers here. */
@Suppress("UNUSED_PARAMETER")
fun NavGraphBuilder.clinicalDestinations(
    graph: AppGraph,
    clinic: () -> ClinicContext?,
    nav: NavController,
) {
}
