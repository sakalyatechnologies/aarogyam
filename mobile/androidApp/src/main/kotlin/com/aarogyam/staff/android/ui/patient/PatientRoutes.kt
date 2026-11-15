package com.aarogyam.staff.android.ui.patient

import android.net.Uri
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.ui.FilesTab
import com.aarogyam.staff.android.ui.NotesTab
import com.aarogyam.staff.android.ui.Patient360Screen
import com.aarogyam.staff.android.ui.RxTab
import com.aarogyam.staff.android.ui.chart.ChartTab
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext

/**
 * The patient page (T13, owned by the patient worker). AppRoot calls [patientDestinations] and every
 * screen opens a patient with [openPatient]. Until the v9 page lands this hosts the v7 Patient 360.
 */
object PatientRoutes {
    const val PATIENT = "patient/{id}"
}

fun NavController.openPatient(id: String) = navigate("patient/${Uri.encode(id)}")

fun NavGraphBuilder.patientDestinations(
    graph: AppGraph,
    clinic: () -> ClinicContext?,
    nav: NavController,
) {
    composable(PatientRoutes.PATIENT) { entry ->
        val open = clinic() ?: return@composable
        val id = entry.arguments?.getString("id") ?: return@composable
        Patient360Screen(
            rememberHolder { graph.patient360(open, id, it) },
            onBack = nav::popBackStack,
            chartTab = { ChartTab(rememberHolder { graph.chart(open, id, it) }) },
            rxTab = { RxTab(graph, open, id, it.flags.allergies) },
            notesTab = { NotesTab(rememberHolder { graph.patientNotes(open, id, it) }) },
            filesTab = { FilesTab(rememberHolder { graph.files(open, id, it) }) },
            billing = rememberHolder { graph.billing(open, id, it) },
        )
    }
}
