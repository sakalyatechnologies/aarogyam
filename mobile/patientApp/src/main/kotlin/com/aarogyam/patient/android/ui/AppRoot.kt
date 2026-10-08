package com.aarogyam.patient.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.aarogyam.patient.PatientGraph
import com.aarogyam.patient.android.GraphState
import com.aarogyam.patient.android.R
import com.sakalya.mobile.auth.SessionState
import com.sakalya.mobile.design.AppTheme
import com.sakalya.mobile.design.BrandPreset
import com.sakalya.mobile.design.ThemeMode
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.flow.StateFlow

/** Destinations once signed in. */
object Routes {
    const val SIGN_IN = "sign-in"
    const val LOADING = "loading"
    const val CLINICS = "clinics"
    const val HOME = "home"
    const val APPOINTMENTS = "appointments"
    const val BOOK = "book"
    const val PRESCRIPTIONS = "prescriptions"
    const val BILLS = "bills"
}

/** Themes the app (Aarogyam's own Tulsi, not one clinic's) and shows what the session calls for. */
@Composable
fun AppRoot(graphState: StateFlow<GraphState>) {
    val state by graphState.collectAsStateWithLifecycle()
    Themed {
        when (val current = state) {
            GraphState.Starting -> {
                LoadingIndicator()
            }

            GraphState.NotConfigured -> {
                SkEmptyState(
                    stringResource(R.string.not_configured_title),
                    stringResource(R.string.not_configured_message),
                )
            }

            is GraphState.Ready -> {
                Signed(current.graph)
            }
        }
    }
}

@Composable
private fun Signed(graph: PatientGraph) {
    val session by graph.sessionState.collectAsStateWithLifecycle()
    val me by graph.directory.me.collectAsStateWithLifecycle()
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
            val signedIn = session is SessionState.SignedIn
            LaunchedEffect(signedIn) { if (signedIn) graph.loadClinics() }
            // A first sign-in goes to My clinics to add one; anyone with a clinic starts at Home.
            val target =
                when {
                    !signedIn -> Routes.SIGN_IN
                    me == null -> Routes.LOADING
                    me?.clinics.isNullOrEmpty() -> Routes.CLINICS
                    else -> Routes.HOME
                }
            val nav = rememberNavController()
            LaunchedEffect(target) {
                val root = nav.currentDestination?.route
                val atRoot = root == null || root in setOf(Routes.SIGN_IN, Routes.LOADING, Routes.CLINICS)
                if (root != target && (atRoot || target == Routes.SIGN_IN)) nav.reset(target)
            }
            Screens(nav, graph, target)
        }
    }
}

@Composable
private fun Screens(
    nav: NavHostController,
    graph: PatientGraph,
    start: String,
) {
    NavHost(nav, startDestination = start) {
        composable(Routes.SIGN_IN) {
            Box(Modifier.fillMaxSize()) {
                SignInScreen(rememberHolder { graph.signIn(it) })
                Box(Modifier.align(Alignment.BottomCenter).systemBarsPadding()) { DevSignInPanel(graph) }
            }
        }
        composable(Routes.LOADING) { LoadingIndicator() }
        composable(Routes.CLINICS) {
            ClinicsScreen(
                rememberHolder { graph.clinics(it) },
                onDone = { if (nav.previousBackStackEntry != null) nav.popBackStack() else nav.reset(Routes.HOME) },
                onSignOut = graph::signOut,
            )
        }
        composable(Routes.HOME) {
            HomeScreen(rememberHolder { graph.home(it) }, onOpen = { nav.navigate(it) }, onSignOut = graph::signOut)
        }
        composable(Routes.APPOINTMENTS) {
            AppointmentsScreen(
                rememberHolder {
                    graph.appointments(it)
                },
                onBack = nav::popBackStack,
                onBook = { nav.navigate(Routes.BOOK) },
            )
        }
        composable(Routes.BOOK) { BookScreen(rememberHolder { graph.booking(it) }, onBack = nav::popBackStack) }
        composable(Routes.PRESCRIPTIONS) {
            PrescriptionsScreen(rememberHolder { graph.prescriptions(it) }, onBack = nav::popBackStack)
        }
        composable(Routes.BILLS) { BillsScreen(rememberHolder { graph.bills(it) }, onBack = nav::popBackStack) }
    }
}

/** Replaces the whole stack with [route]. */
fun NavHostController.reset(route: String) =
    navigate(route) {
        popUpTo(graph.id) { inclusive = true }
        launchSingleTop = true
    }

@Composable
private fun Themed(content: @Composable () -> Unit) {
    val theme = AppTheme.create(BrandPreset.Tulsi.brand, if (isSystemInDarkTheme()) ThemeMode.Dark else ThemeMode.Light)
    SkTheme(theme) {
        Box(Modifier.fillMaxSize().background(SkTheme.colors.background.color)) { content() }
    }
}
