package com.aarogyam.staff.android.ui.more

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.android.ui.timeoff.TimeOffPage
import com.aarogyam.staff.clinic.ClinicContext

private object MoreRoute {
    const val STOCK = "more/stock"
    const val HELP = "more/help"
    const val TIME_OFF = "more/time_off"
}

fun NavController.openStock() = navigate(MoreRoute.STOCK)

fun NavController.openHelp() = navigate(MoreRoute.HELP)

fun NavController.openTimeOff() = navigate(MoreRoute.TIME_OFF)

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
    composable(MoreRoute.TIME_OFF) {
        val open = clinic() ?: return@composable
        TimeOffPage(rememberHolder { graph.timeOff(open, it) }, open, onBack = nav::popBackStack)
    }
}
