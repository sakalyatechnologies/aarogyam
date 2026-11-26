package com.aarogyam.staff.android.ui.patient

import android.net.Uri
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.clinic.ClinicContext

/** The patient page (T13, owned by the patient worker): the v9 page with Overview, History and Consent. */
object PatientRoutes {
    const val PATIENT = "patient/{id}"
    const val VISIT = "patient/{id}/visit/{visitId}"
}

fun NavController.openPatient(id: String) = navigate("patient/${Uri.encode(id)}")

private fun NavController.openVisitDetail(
    patientId: String,
    visitId: String,
) = navigate("patient/${Uri.encode(patientId)}/visit/${Uri.encode(visitId)}")

/**
 * [startTreatment] is the visit area's `openVisitForPatient`; the coordinator passes it at merge
 * (until then Start treatment does nothing).
 */
fun NavGraphBuilder.patientDestinations(
    graph: AppGraph,
    clinic: () -> ClinicContext?,
    nav: NavController,
    startTreatment: (String) -> Unit = {},
) {
    composable(PatientRoutes.PATIENT) { entry ->
        val open = clinic() ?: return@composable
        val id = entry.arguments?.getString("id") ?: return@composable
        PatientPage(
            graph,
            open,
            id,
            onBack = nav::popBackStack,
            onOpenVisit = { nav.openVisitDetail(id, it) },
            onStartTreatment = startTreatment,
            onOpenPatient = nav::openPatient,
        )
    }
    composable(PatientRoutes.VISIT) { entry ->
        val open = clinic() ?: return@composable
        val id = entry.arguments?.getString("id") ?: return@composable
        val visitId = entry.arguments?.getString("visitId") ?: return@composable
        VisitDetailScreen(graph, open, id, visitId, onBack = nav::popBackStack)
    }
}
