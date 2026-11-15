package com.aarogyam.staff.android.ui.visit

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.api.queue
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Outcome

private const val FROM_QUEUE = "visit/queue/{tokenId}"
private const val FOR_PATIENT = "visit/patient/{patientId}"

/** Starts treatment from a queue token (as iOS `VisitRoute.fromQueue`); the patient is read from the queue. */
fun NavController.openVisitFromQueue(tokenId: String) = navigate("visit/queue/${Uri.encode(tokenId)}")

/** Starts treatment for a patient with no queue token (as iOS `VisitRoute.fromPatient`). */
fun NavController.openVisitForPatient(patientId: String) = navigate("visit/patient/${Uri.encode(patientId)}")

/** The visit (T13, owned by the visit worker): start, chair, tooth line, notes, dictation, inline Rx and Wrap up. */
fun NavGraphBuilder.visitDestinations(
    graph: AppGraph,
    clinic: () -> ClinicContext?,
    nav: NavController,
) {
    composable(FROM_QUEUE) { entry ->
        val open = clinic() ?: return@composable
        val tokenId = entry.arguments?.getString("tokenId") ?: return@composable
        QueueVisit(graph, open, tokenId, nav)
    }
    composable(FOR_PATIENT) { entry ->
        val open = clinic() ?: return@composable
        val patientId = entry.arguments?.getString("patientId") ?: return@composable
        VisitScreen(graph, open, VisitTarget(patientId), onBack = nav::popBackStack, onCollect = { nav.popBackStack() })
    }
}

/** Finds the token's patient in today's queue, then opens the visit on that token. */
@Composable
private fun QueueVisit(
    graph: AppGraph,
    clinic: ClinicContext,
    tokenId: String,
    nav: NavController,
) {
    val patientId by produceState<String?>(null, tokenId) {
        value =
            (clinic.api.queue() as? Outcome.Success)
                ?.value
                ?.items
                ?.firstOrNull { it.id == tokenId }
                ?.patient
                ?.id
    }
    val found = patientId
    if (found == null) {
        LoadingIndicator()
    } else {
        VisitScreen(graph, clinic, VisitTarget(found, tokenId = tokenId), onBack = nav::popBackStack, onCollect = {
            nav.popBackStack()
        })
    }
}
