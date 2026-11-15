package com.aarogyam.staff.android.ui.clinical

import androidx.compose.runtime.Composable
import androidx.navigation.NavController
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.ComingSoon
import com.aarogyam.staff.clinic.ClinicContext

// STUB (shell worker): the clinical worker's openers replace these at merge; the coordinator deletes this file.

fun NavController.openLabs() {
}

fun NavController.openChats() {
}

fun NavController.openTeam() {
}

fun NavController.openAnalytics() {
}

fun NavController.openExpenses() {
}

/** The month's expenses as the finance role's Expenses tab (iOS `ClinicalRoutes.expensesPage`); clinical supplies the real page. */
@Suppress("UNUSED_PARAMETER")
@Composable
fun ExpensesPage(
    graph: AppGraph,
    clinic: ClinicContext,
    showsAdd: Boolean,
) {
    ComingSoon(R.string.v7_tab_expenses)
}
