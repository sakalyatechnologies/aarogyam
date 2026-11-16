package com.aarogyam.staff.android.ui.clinical

import androidx.compose.runtime.Composable
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext

/**
 * The finance role's Expenses tab (iOS `ClinicalRoutes.expensesPage`): the expenses screen with no
 * back action. [showsAdd] is false when the tab bar's own action adds an expense.
 */
@Composable
fun ExpensesPage(
    graph: AppGraph,
    clinic: ClinicContext,
    showsAdd: Boolean,
) {
    ExpensesScreen(rememberHolder { graph.expenses(clinic, it) }, onBack = null, showsAdd = showsAdd)
}
