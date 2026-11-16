package com.aarogyam.staff.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
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
import com.aarogyam.staff.android.ui.clinical.clinicalDestinations
import com.aarogyam.staff.android.ui.desk.deskDestinations
import com.aarogyam.staff.android.ui.desk.openDeskLookup
import com.aarogyam.staff.android.ui.live.LiveBannerOverlay
import com.aarogyam.staff.android.ui.more.shellDestinations
import com.aarogyam.staff.android.ui.patient.patientDestinations
import com.aarogyam.staff.android.ui.visit.openVisitForPatient
import com.aarogyam.staff.android.ui.visit.visitDestinations
import com.aarogyam.staff.android.ui.walkin.WalkInScreen
import com.aarogyam.staff.clinic.ClinicBranding
import com.sakalya.mobile.auth.SessionState
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.flow.StateFlow

private object Routes {
    const val SIGN_IN = "sign-in"
    const val CLINICS = "clinics"
    const val MAIN = "main"
    const val WALK_IN = "walk-in"
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
                        val clinicCount by produceState(1, graph) {
                            value = (graph.directory.clinics() as? Outcome.Success)?.value?.size ?: 1
                        }
                        MainScreen(
                            graph,
                            open,
                            clinicCount,
                            nav,
                            // As iOS: Walk-in opens the desk lookup (number, profile, check in or new patient).
                            onWalkIn = { nav.openDeskLookup() },
                            onSwitchClinic = {
                                chose = true
                                graph.directory.leave()
                            },
                        )
                    }
                    composable(Routes.WALK_IN) {
                        val open = clinic ?: return@composable
                        WalkInScreen(rememberHolder { graph.walkIn(open, it) }, onClose = nav::popBackStack)
                    }
                    patientDestinations(graph, { clinic }, nav, startTreatment = { nav.openVisitForPatient(it) })
                    deskDestinations(graph, { clinic }, nav)
                    visitDestinations(graph, { clinic }, nav)
                    clinicalDestinations(graph, { clinic }, nav)
                    shellDestinations(graph, { clinic }, nav)
                }
                // The live banner shows over every screen of the signed-in app (iOS `RoutesV10Live.hook`).
                clinic?.takeIf { target == Routes.MAIN }?.let { open ->
                    LiveBannerOverlay(open) { nav.popBackStack(Routes.MAIN, inclusive = false) }
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
