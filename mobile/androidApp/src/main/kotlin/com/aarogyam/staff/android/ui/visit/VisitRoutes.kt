package com.aarogyam.staff.android.ui.visit

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.clinic.ClinicContext

/** The visit (T13, owned by the visit worker): start, chair, tooth line, notes, dictation, inline Rx and Wrap up. AppRoot calls [visitDestinations]; the worker adds its routes and openers here. */
@Suppress("UNUSED_PARAMETER")
fun NavGraphBuilder.visitDestinations(
    graph: AppGraph,
    clinic: () -> ClinicContext?,
    nav: NavController,
) {
}
