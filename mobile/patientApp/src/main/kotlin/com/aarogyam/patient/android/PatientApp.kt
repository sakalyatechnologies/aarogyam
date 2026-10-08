package com.aarogyam.patient.android

import android.app.Application
import com.aarogyam.patient.PatientGraph
import com.aarogyam.patient.config.AppConfig
import com.aarogyam.patient.config.AppEnvironment
import com.sakalya.mobile.http.ConnectivityNetworkMonitor
import com.sakalya.mobile.securestorage.PlatformSecureStore
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Whether the app graph is ready. */
sealed interface GraphState {
    data object Starting : GraphState

    /** The build has no Supabase URL or key. */
    data object NotConfigured : GraphState

    data class Ready(
        val graph: PatientGraph,
    ) : GraphState
}

/** Holds the one [PatientGraph] for the process. */
class PatientApp : Application() {
    private val scope = MainScope()
    private val mutableGraph = MutableStateFlow<GraphState>(GraphState.Starting)

    /** The graph once it is built. */
    val graph: StateFlow<GraphState> = mutableGraph.asStateFlow()

    override fun onCreate() {
        super.onCreate()
        val config =
            AppConfig(
                environment = AppEnvironment.valueOf(BuildConfig.ENVIRONMENT),
                version = BuildConfig.VERSION_NAME,
                debug = BuildConfig.DEBUG,
                supabaseUrl = BuildConfig.SUPABASE_URL,
                supabaseKey = BuildConfig.SUPABASE_KEY,
                prodAppHost = BuildConfig.PROD_APP_HOST,
            )
        scope.launch {
            val graph =
                PatientGraph.create(
                    config,
                    PlatformSecureStore(this@PatientApp, STORE),
                    scope,
                    ConnectivityNetworkMonitor(this@PatientApp),
                )
            mutableGraph.value = graph?.let(GraphState::Ready) ?: GraphState.NotConfigured
        }
    }

    companion object {
        /** The secure store's name for this app's session. */
        const val STORE = "aarogyam-patient"
    }
}
