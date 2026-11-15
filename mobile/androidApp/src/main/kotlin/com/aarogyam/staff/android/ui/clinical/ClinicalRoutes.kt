package com.aarogyam.staff.android.ui.clinical

import android.net.Uri
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.ui.labs.LabsScreen
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext

/** Labs, team chat and the More extras (T13, owned by the clinical worker). AppRoot calls [clinicalDestinations]. */
object ClinicalRoutes {
    const val CHATS = "clinical/chats"
    const val CHAT = "clinical/chat/{id}?title={title}"
    const val LABS = "clinical/labs"
    const val TEAM = "clinical/team"
}

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
            onBack = nav::popBackStack,
            onChats = nav::openChats,
            onOpenChat = nav::openChat,
        )
    }
}
