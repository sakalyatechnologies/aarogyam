package com.aarogyam.staff.android.ui.clinical

import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.ComingSoon
import com.aarogyam.staff.android.ui.labs.LabsScreen
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.color

/** Labs, team chat and the More extras (T13, owned by the clinical worker). AppRoot calls [clinicalDestinations]. */
object ClinicalRoutes {
    const val CHATS = "clinical/chats"
    const val CHAT = "clinical/chat/{id}?title={title}"
    const val LABS = "clinical/labs"
    const val TEAM = "clinical/team"
    const val EXPENSES = "clinical/expenses"
    const val ANALYTICS = "clinical/analytics"
}

fun NavController.openExpenses() = navigate(ClinicalRoutes.EXPENSES)

fun NavController.openAnalytics() = navigate(ClinicalRoutes.ANALYTICS)

fun NavController.openLabs() = navigate(ClinicalRoutes.LABS)

fun NavController.openTeam() = navigate(ClinicalRoutes.TEAM)

fun NavController.openChats() = navigate(ClinicalRoutes.CHATS)

fun NavController.openChat(
    id: String,
    title: String,
) = navigate("clinical/chat/${Uri.encode(id)}?title=${Uri.encode(title)}")

fun NavGraphBuilder.clinicalDestinations(
    graph: AppGraph,
    clinic: () -> ClinicContext?,
    nav: NavController,
) {
    composable(ClinicalRoutes.CHATS) {
        val open = clinic() ?: return@composable
        ChatListScreen(rememberHolder { graph.chatList(open, it) }, onBack = nav::popBackStack, onOpen = nav::openChat)
    }
    composable(ClinicalRoutes.CHAT) { entry ->
        val open = clinic() ?: return@composable
        val id = entry.arguments?.getString("id") ?: return@composable
        val title = entry.arguments?.getString("title").orEmpty()
        ChatThreadScreen(rememberHolder { graph.chatThread(open, id, it) }, title, onBack = nav::popBackStack)
    }
    composable(ClinicalRoutes.LABS) {
        val open = clinic() ?: return@composable
        LabsScreen(graph, open, rememberHolder { graph.labs(open, it) }, onBack = nav::popBackStack)
    }
    composable(ClinicalRoutes.TEAM) {
        val open = clinic() ?: return@composable
        TeamScreen(
            rememberHolder { graph.team(open, it) },
            canChat = "chat.use" in open.permissions,
            invite = if ("staff.manage" in open.permissions) ({ graph.inviteStaff(open, it) }) else null,
            onBack = nav::popBackStack,
            onChats = nav::openChats,
            onOpenChat = nav::openChat,
        )
    }
    composable(ClinicalRoutes.EXPENSES) {
        val open = clinic() ?: return@composable
        ExpensesScreen(rememberHolder { graph.expenses(open, it) }, onBack = nav::popBackStack)
    }
    composable(ClinicalRoutes.ANALYTICS) {
        val open = clinic() ?: return@composable
        AnalyticsScreen(graph, open, rememberHolder { graph.analytics(open, it) }, onBack = nav::popBackStack)
    }
}
