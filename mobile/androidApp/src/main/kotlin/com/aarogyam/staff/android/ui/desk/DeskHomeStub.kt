package com.aarogyam.staff.android.ui.desk

import androidx.compose.runtime.Composable
import androidx.navigation.NavController
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.ComingSoon
import com.aarogyam.staff.clinic.ClinicContext

/** STUB (shell worker): the desk worker's DeskHome replaces this at merge; the coordinator deletes this file. */
@Suppress("UNUSED_PARAMETER")
@Composable
fun DeskHome(
    graph: AppGraph,
    clinic: ClinicContext,
    nav: NavController,
) {
    ComingSoon(R.string.tab_today)
}

/** STUB (shell worker): the desk worker's opener (desk role's Walk-in action) replaces this at merge. */
fun androidx.navigation.NavController.openDeskLookup() {
}
