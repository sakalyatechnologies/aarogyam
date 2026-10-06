package com.aarogyam.staff

import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.clinic.ClinicDirectory
import com.aarogyam.staff.clinic.ClinicPickerStateHolder
import com.aarogyam.staff.config.AppConfig
import com.aarogyam.staff.config.Hosts
import com.aarogyam.staff.signin.SignInStateHolder
import com.aarogyam.staff.today.TodayStateHolder
import com.sakalya.mobile.auth.PublishableKey
import com.sakalya.mobile.auth.SecureSessionStore
import com.sakalya.mobile.auth.SessionManager
import com.sakalya.mobile.auth.SessionState
import com.sakalya.mobile.auth.SupabaseAuthClient
import com.sakalya.mobile.auth.SupabaseAuthConfig
import com.sakalya.mobile.core.Clock
import com.sakalya.mobile.core.DeviceId
import com.sakalya.mobile.core.LogLevel
import com.sakalya.mobile.core.LogSink
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.core.platformLogSink
import com.sakalya.mobile.http.BaseUrl
import com.sakalya.mobile.http.ClientIdentity
import com.sakalya.mobile.http.DeviceInfo
import com.sakalya.mobile.http.HttpClientFactory
import com.sakalya.mobile.http.HttpSettings
import com.sakalya.mobile.http.NetworkMonitor
import com.sakalya.mobile.http.platformHttpEngine
import com.sakalya.mobile.securestorage.SecureStore
import com.sakalya.mobile.securestorage.deviceId
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * The app's object graph (manual DI): one HTTP engine, one session, one client per host.
 * Build it with [create]; state holders come from the factory functions.
 */
class AppGraph private constructor(
    val config: AppConfig,
    private val scope: CoroutineScope,
    private val factory: HttpClientFactory,
    val sessions: SessionManager,
    private val logger: (String) -> Logger,
) {
    private val clients = mutableMapOf<BaseUrl, HttpClient>()

    /** The person's clinics and the open one. */
    val directory: ClinicDirectory =
        ClinicDirectory(Hosts(config), ::clientFor, logger("aarogyam.clinics"))

    /** Restoring, signed out or signed in. */
    val sessionState: StateFlow<SessionState> get() = sessions.state

    init {
        // A session that ends (refresh rejected, or sign-out) drops every clinic's cached data.
        scope.launch { sessions.state.collect { if (it is SessionState.SignedOut) directory.clear() } }
    }

    fun signIn(scope: CoroutineScope): SignInStateHolder = SignInStateHolder(sessions, scope)

    fun clinicPicker(
        scope: CoroutineScope,
        autoOpenSingle: Boolean,
    ): ClinicPickerStateHolder = ClinicPickerStateHolder(directory, scope, autoOpenSingle)

    fun today(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): TodayStateHolder = TodayStateHolder(clinic, scope, logger("aarogyam.today"))

    /** Restores the session again, after secure storage was unavailable. */
    fun restore() {
        scope.launch { sessions.restore() }
    }

    /** Revokes the session at Supabase and clears secure storage and the caches. */
    fun signOut() {
        scope.launch {
            sessions.signOut()
            directory.clear()
        }
    }

    private fun clientFor(base: BaseUrl): HttpClient =
        clients.getOrPut(base) { factory.create(base, tokens = sessions) }

    companion object {
        /**
         * Builds the graph and starts restoring the session. Fails only when this build has no
         * valid Supabase URL. [store] holds the session and the device ID; every log line goes to
         * [logSink] (tests pass a `MemoryLogSink`).
         */
        suspend fun create(
            config: AppConfig,
            store: SecureStore,
            scope: CoroutineScope,
            network: NetworkMonitor = NetworkMonitor.AlwaysOnline,
            engine: HttpClientEngine = platformHttpEngine(),
            clock: Clock = Clock.System,
            logSink: LogSink = platformLogSink(),
        ): AppGraph? {
            val level = if (config.debug) LogLevel.Debug else LogLevel.Info
            val logger = { tag: String -> Logger(tag, logSink, level) }
            val log = logger("aarogyam.app")
            val projectUrl = BaseUrl.parse(config.supabaseUrl, allowCleartext = config.debug)
            if (projectUrl == null || config.supabaseKey.isBlank()) {
                log.error("app.supabase_missing")
                return null
            }
            // A locked store still gets a working app; the ID is then per launch.
            val deviceId =
                when (val read = store.deviceId()) {
                    is Outcome.Success -> read.value
                    is Outcome.Failure -> DeviceId.generate().also { log.warn("app.device_id_unavailable") }
                }
            val settings = HttpSettings(ClientIdentity("aarogyam-staff", config.version), DeviceInfo(deviceId))
            val auth =
                SupabaseAuthClient(
                    SupabaseAuthConfig(projectUrl, PublishableKey(config.supabaseKey)),
                    engine,
                    network,
                    clock,
                )
            val sessions = SessionManager(auth, SecureSessionStore(store), clock, logger("sakalya.auth"))
            val graph = AppGraph(config, scope, HttpClientFactory(settings, engine, network, clock), sessions, logger)
            scope.launch { sessions.restore() }
            return graph
        }
    }
}
