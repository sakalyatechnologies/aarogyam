package com.aarogyam.staff.android.ui.clinical

import android.net.Uri
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext

/** Labs, team chat and the More extras (T13, owned by the clinical worker). AppRoot calls [clinicalDestinations]. */
object ClinicalRoutes {
    const val CHATS = "clinical/chats"
    const val CHAT = "clinical/chat/{id}?title={title}"
}

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
}
