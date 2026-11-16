package com.aarogyam.staff.android.ui.more

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext

private object MoreRoute {
    const val STOCK = "more/stock"
    const val HELP = "more/help"
}

fun NavController.openStock() = navigate(MoreRoute.STOCK)

fun NavController.openHelp() = navigate(MoreRoute.HELP)

/** The shell's own pushed pages from More: the low-stock list and Help. AppRoot calls this once. */
fun NavGraphBuilder.shellDestinations(
    graph: AppGraph,
    clinic: () -> ClinicContext?,
    nav: NavController,
) {
    composable(MoreRoute.STOCK) {
        val open = clinic() ?: return@composable
        StockPage(rememberHolder { graph.stock(open, it) }, onBack = nav::popBackStack)
    }
    composable(MoreRoute.HELP) { HelpPage(onBack = nav::popBackStack) }
}
