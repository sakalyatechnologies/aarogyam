package com.aarogyam.staff.android.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.GraphState
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.chart.ChartTab
import com.aarogyam.staff.clinic.ClinicBranding
import com.sakalya.mobile.auth.SessionState
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.flow.StateFlow

private object Routes {
    const val SIGN_IN = "sign-in"
    const val CLINICS = "clinics"
    const val MAIN = "main"
    const val PATIENT = "patient/{id}"
}

/** Themes the app from the open clinic's brand and shows the screen the session calls for. */
@Composable
fun AppRoot(graphState: StateFlow<GraphState>) {
    val state by graphState.collectAsStateWithLifecycle()
    when (val current = state) {
        GraphState.Starting -> {
            Themed(ClinicBranding.Default) { LoadingIndicator() }
        }

        GraphState.NotConfigured -> {
            Themed(ClinicBranding.Default) {
                SkEmptyState(
                    stringResource(R.string.not_configured_title),
                    stringResource(R.string.not_configured_message),
                )
            }
        }

        is GraphState.Ready -> {
            Signed(current.graph)
        }
    }
}

@Composable
private fun Signed(graph: AppGraph) {
    val session by graph.sessionState.collectAsStateWithLifecycle()
    val clinic by graph.directory.current.collectAsStateWithLifecycle()
    // After the person leaves a clinic, the picker waits for a tap even if there is only one.
    var chose by rememberSaveable { mutableStateOf(false) }
    Themed(clinic?.branding ?: ClinicBranding.Default) {
        when (session) {
            SessionState.Restoring -> {
                LoadingIndicator()
            }

            SessionState.StorageUnavailable -> {
                SkEmptyState(
                    stringResource(R.string.storage_unavailable_title),
                    stringResource(R.string.storage_unavailable_message),
                    actionLabel = stringResource(R.string.try_again),
                    onAction = graph::restore,
                )
            }

            else -> {
                val target =
                    when {
                        session !is SessionState.SignedIn -> Routes.SIGN_IN
                        clinic == null -> Routes.CLINICS
                        else -> Routes.MAIN
                    }
                val nav = rememberNavController()
                // Each move replaces the stack, so a screen's state holder ends with it.
                LaunchedEffect(target) {
                    if (nav.currentDestination?.route != target) {
                        nav.navigate(target) {
                            popUpTo(nav.graph.id) { inclusive = true }
                            launchSingleTop = true
                        }
                    }
                }
                NavHost(nav, startDestination = target) {
                    composable(Routes.SIGN_IN) {
                        LaunchedEffect(Unit) { chose = false }
                        Box(Modifier.fillMaxSize()) {
                            SignInScreen(rememberHolder { graph.signIn(it) })
                            Box(Modifier.align(Alignment.BottomCenter).systemBarsPadding()) { DevSignInPanel(graph) }
                        }
                    }
                    composable(Routes.CLINICS) {
                        ClinicPickerScreen(
                            rememberHolder { graph.clinicPicker(it, autoOpenSingle = !chose) },
                            onSignOut = graph::signOut,
                        )
                    }
                    composable(Routes.MAIN) {
                        val open = clinic ?: return@composable
                        MainScreen(
                            graph,
                            open,
                            onOpenPatient = { nav.navigate("patient/${Uri.encode(it)}") },
                            onSwitchClinic = {
                                chose = true
                                graph.directory.leave()
                            },
                            onSignOut = graph::signOut,
                        )
                    }
                    composable(Routes.PATIENT) { entry ->
                        val open = clinic ?: return@composable
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
            }
        }
    }
}

@Composable
private fun Themed(
    branding: ClinicBranding,
    content: @Composable () -> Unit,
) {
    SkTheme(branding.theme(isSystemInDarkTheme())) {
        Box(Modifier.fillMaxSize().background(SkTheme.colors.background.color)) { content() }
    }
}
