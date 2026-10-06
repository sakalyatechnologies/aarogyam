package com.aarogyam.staff.android

import android.app.Application
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.config.AppConfig
import com.aarogyam.staff.config.AppEnvironment
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
        val graph: AppGraph,
    ) : GraphState
}

/** Holds the one [AppGraph] for the process. */
class AarogyamApp : Application() {
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
                AppGraph.create(
                    config,
                    PlatformSecureStore(this@AarogyamApp, "aarogyam"),
                    scope,
                    ConnectivityNetworkMonitor(this@AarogyamApp),
                )
            mutableGraph.value = graph?.let(GraphState::Ready) ?: GraphState.NotConfigured
        }
    }
}
