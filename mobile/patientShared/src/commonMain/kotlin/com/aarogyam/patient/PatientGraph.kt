package com.aarogyam.patient

import com.aarogyam.patient.appointments.AppointmentsStateHolder
import com.aarogyam.patient.booking.BookingStateHolder
import com.aarogyam.patient.clinics.ClinicsStateHolder
import com.aarogyam.patient.config.AppConfig
import com.aarogyam.patient.config.Hosts
import com.aarogyam.patient.home.HomeStateHolder
import com.aarogyam.patient.records.BillsStateHolder
import com.aarogyam.patient.records.PrescriptionsStateHolder
import com.aarogyam.patient.signin.SignInStateHolder
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
 * The patient app's object graph (manual DI): one HTTP engine, one session, one client per host,
 * and the linked clinics. Build it with [create]; state holders come from the factory functions.
 */
class PatientGraph private constructor(
    val config: AppConfig,
    private val scope: CoroutineScope,
    private val factory: HttpClientFactory,
    val sessions: SessionManager,
    private val logger: (String) -> Logger,
) {
    private val clients = mutableMapOf<BaseUrl, HttpClient>()

    /** The patient's linked clinics, cached until a link changes or sign-out. */
    val directory: PatientDirectory = PatientDirectory(Hosts(config), ::clientFor, logger("aarogyam.patient.clinics"))

    /** Restoring, signed out or signed in. */
    val sessionState: StateFlow<SessionState> get() = sessions.state

    init {
        scope.launch { sessions.state.collect { if (it is SessionState.SignedOut) directory.clear() } }
    }

    fun signIn(scope: CoroutineScope): SignInStateHolder = SignInStateHolder(sessions, scope)

    fun clinics(scope: CoroutineScope): ClinicsStateHolder =
        ClinicsStateHolder(directory, scope, logger("aarogyam.patient.clinics"))

    fun home(scope: CoroutineScope): HomeStateHolder =
        HomeStateHolder(directory, scope, logger("aarogyam.patient.home"))

    fun appointments(scope: CoroutineScope): AppointmentsStateHolder =
        AppointmentsStateHolder(directory, scope, logger("aarogyam.patient.appointments"))

    fun booking(scope: CoroutineScope): BookingStateHolder =
        BookingStateHolder(directory, scope, logger("aarogyam.patient.booking"))

    fun prescriptions(scope: CoroutineScope): PrescriptionsStateHolder = PrescriptionsStateHolder(directory, scope)

    fun bills(scope: CoroutineScope): BillsStateHolder = BillsStateHolder(directory, scope)

    /** Loads the linked clinics, so the root knows whether to show My clinics or Home. */
    fun loadClinics() {
        scope.launch { directory.load(refresh = true) }
    }

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
         * valid Supabase URL. Logs carry ids and codes only, never health data.
         */
        suspend fun create(
            config: AppConfig,
            store: SecureStore,
            scope: CoroutineScope,
            network: NetworkMonitor = NetworkMonitor.AlwaysOnline,
            engine: HttpClientEngine = platformHttpEngine(),
            clock: Clock = Clock.System,
            logSink: LogSink = platformLogSink(),
        ): PatientGraph? {
            val level = if (config.debug) LogLevel.Debug else LogLevel.Info
            val logger = { tag: String -> Logger(tag, logSink, level) }
            val log = logger("aarogyam.patient.app")
            val projectUrl = BaseUrl.parse(config.supabaseUrl, allowCleartext = config.debug)
            if (projectUrl == null || config.supabaseKey.isBlank()) {
                log.error("app.supabase_missing")
                return null
            }
            val deviceId =
                when (val read = store.deviceId()) {
                    is Outcome.Success -> read.value
                    is Outcome.Failure -> DeviceId.generate().also { log.warn("app.device_id_unavailable") }
                }
            val settings = HttpSettings(ClientIdentity("aarogyam-patient", config.version), DeviceInfo(deviceId))
            val auth =
                SupabaseAuthClient(
                    SupabaseAuthConfig(projectUrl, PublishableKey(config.supabaseKey)),
                    engine,
                    network,
                    clock,
                )
            val sessions = SessionManager(auth, SecureSessionStore(store), clock, logger("sakalya.auth"))
            val graph =
                PatientGraph(config, scope, HttpClientFactory(settings, engine, network, clock), sessions, logger)
            scope.launch { sessions.restore() }
            return graph
        }
    }
}
