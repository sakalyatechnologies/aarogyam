package com.aarogyam.staff

import com.aarogyam.staff.analytics.AnalyticsStateHolder
import com.aarogyam.staff.billing.BillingStateHolder
import com.aarogyam.staff.booking.BookingStateHolder
import com.aarogyam.staff.calendar.CalendarStateHolder
import com.aarogyam.staff.chart.ChartStateHolder
import com.aarogyam.staff.chart.ToothSheetStateHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.clinic.ClinicDirectory
import com.aarogyam.staff.clinic.ClinicPickerStateHolder
import com.aarogyam.staff.config.AppConfig
import com.aarogyam.staff.config.Hosts
import com.aarogyam.staff.device.Dictation
import com.aarogyam.staff.device.MemoryPreferences
import com.aarogyam.staff.device.Preferences
import com.aarogyam.staff.expenses.ExpensesStateHolder
import com.aarogyam.staff.files.FilesStateHolder
import com.aarogyam.staff.labs.LabsStateHolder
import com.aarogyam.staff.labs.NewLabCaseStateHolder
import com.aarogyam.staff.notes.PatientNotesStateHolder
import com.aarogyam.staff.patients.AllergyView
import com.aarogyam.staff.patients.Patient360StateHolder
import com.aarogyam.staff.patients.PatientsStateHolder
import com.aarogyam.staff.prescriptions.RxListStateHolder
import com.aarogyam.staff.prescriptions.RxSheetStateHolder
import com.aarogyam.staff.queue.QueueStateHolder
import com.aarogyam.staff.schedule.ScheduleStateHolder
import com.aarogyam.staff.schedule.WeekStateHolder
import com.aarogyam.staff.signin.InviteStateHolder
import com.aarogyam.staff.signin.RegistrationStateHolder
import com.aarogyam.staff.signin.SignInStateHolder
import com.aarogyam.staff.team.BadgesStateHolder
import com.aarogyam.staff.team.ChatListStateHolder
import com.aarogyam.staff.team.ChatThreadStateHolder
import com.aarogyam.staff.team.InboxStateHolder
import com.aarogyam.staff.team.NotificationsStateHolder
import com.aarogyam.staff.team.StockStateHolder
import com.aarogyam.staff.team.TeamStateHolder
import com.aarogyam.staff.today.TodayStateHolder
import com.aarogyam.staff.visit.VisitStateHolder
import com.aarogyam.staff.walkin.WalkInStateHolder
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
import kotlinx.datetime.LocalDate

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
    /** Small device settings: avatar choice, dictation language. */
    val preferences: Preferences,
    /** The platform speech recogniser for voice notes. */
    val dictation: Dictation,
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

    fun patients(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): PatientsStateHolder = PatientsStateHolder(clinic, scope, logger("aarogyam.patients"))

    fun patient360(
        clinic: ClinicContext,
        patientId: String,
        scope: CoroutineScope,
    ): Patient360StateHolder = Patient360StateHolder(clinic, patientId, scope, logger("aarogyam.patient360"))

    fun files(
        clinic: ClinicContext,
        patientId: String,
        scope: CoroutineScope,
    ): FilesStateHolder = FilesStateHolder(clinic, patientId, scope, logger("aarogyam.files"))

    fun chart(
        clinic: ClinicContext,
        patientId: String,
        scope: CoroutineScope,
    ): ChartStateHolder = ChartStateHolder(clinic, patientId, scope, logger("aarogyam.chart"))

    fun patientNotes(
        clinic: ClinicContext,
        patientId: String,
        scope: CoroutineScope,
    ): PatientNotesStateHolder = PatientNotesStateHolder(clinic, patientId, scope, logger("aarogyam.patientnotes"))

    fun rxList(
        clinic: ClinicContext,
        patientId: String,
        scope: CoroutineScope,
    ): RxListStateHolder = RxListStateHolder(clinic, patientId, scope, logger("aarogyam.rxlist"))

    /** [allergies] are the patient's recorded ones, from Patient 360's banner; [visitId] links it to an open visit. */
    fun rxSheet(
        clinic: ClinicContext,
        patientId: String,
        allergies: List<AllergyView>,
        scope: CoroutineScope,
        visitId: String? = null,
    ): RxSheetStateHolder = RxSheetStateHolder(clinic, patientId, allergies, scope, visitId, logger("aarogyam.rxsheet"))

    fun billing(
        clinic: ClinicContext,
        patientId: String,
        scope: CoroutineScope,
    ): BillingStateHolder = BillingStateHolder(clinic, patientId, scope, logger("aarogyam.billing"))

    fun walkIn(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): WalkInStateHolder = WalkInStateHolder(clinic, scope, logger("aarogyam.walkin"))

    fun queue(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): QueueStateHolder = QueueStateHolder(clinic, scope, logger("aarogyam.queue"))

    fun calendar(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): CalendarStateHolder = CalendarStateHolder(clinic, scope, logger("aarogyam.calendar"))

    /** The Schedule tab: Queue, Day and Week, each made the first time it shows. */
    fun schedule(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): ScheduleStateHolder =
        ScheduleStateHolder(
            makeQueue = { queue(clinic, scope) },
            makeDay = { calendar(clinic, scope) },
            makeWeek = { WeekStateHolder(clinic, scope, logger("aarogyam.week")) },
        )

    /** The booking sheet for [patientId], opening on [date]. */
    fun booking(
        clinic: ClinicContext,
        patientId: String,
        date: LocalDate,
        scope: CoroutineScope,
    ): BookingStateHolder = BookingStateHolder(clinic, patientId, date, scope, logger("aarogyam.booking"))

    fun analytics(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): AnalyticsStateHolder = AnalyticsStateHolder(clinic, scope, logger("aarogyam.analytics"))

    fun expenses(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): ExpensesStateHolder = ExpensesStateHolder(clinic, scope, logger("aarogyam.expenses"))

    /** The tooth sheet's Add treatment form over [chart]; inside [visitId] it also logs visit procedures. */
    fun toothSheet(
        clinic: ClinicContext,
        chart: ChartStateHolder,
        visitId: String?,
        scope: CoroutineScope,
    ): ToothSheetStateHolder = ToothSheetStateHolder(clinic, chart, visitId, scope, logger("aarogyam.toothsheet"))

    /** Start treatment: the Visit screen, from [tokenId] when the patient is queued. */
    fun visit(
        clinic: ClinicContext,
        patientId: String,
        tokenId: String?,
        appointmentId: String?,
        scope: CoroutineScope,
    ): VisitStateHolder =
        VisitStateHolder(clinic, patientId, tokenId, appointmentId, dictation, scope, logger("aarogyam.visit"))

    /** Joining from an invitation [link] (or one pasted later); the token stays in memory. */
    fun invite(
        scope: CoroutineScope,
        link: String?,
    ): InviteStateHolder = InviteStateHolder(directory, scope, link, logger("aarogyam.invite"))

    fun registration(scope: CoroutineScope): RegistrationStateHolder =
        RegistrationStateHolder(directory.appApi(), scope, logger("aarogyam.registration"))

    fun chatList(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): ChatListStateHolder = ChatListStateHolder(clinic, scope, logger("aarogyam.chat"))

    fun chatThread(
        clinic: ClinicContext,
        conversationId: String,
        scope: CoroutineScope,
    ): ChatThreadStateHolder = ChatThreadStateHolder(clinic, conversationId, scope, logger("aarogyam.chat"))

    fun team(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): TeamStateHolder = TeamStateHolder(clinic, scope, logger("aarogyam.team"))

    fun stock(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): StockStateHolder = StockStateHolder(clinic, scope, logger("aarogyam.stock"))

    fun notifications(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): NotificationsStateHolder = NotificationsStateHolder(clinic, scope, logger("aarogyam.notifications"))

    fun inbox(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): InboxStateHolder = InboxStateHolder(clinic, scope, logger("aarogyam.inbox"))

    fun badges(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): BadgesStateHolder = BadgesStateHolder(clinic, scope)

    /** Lab work: cases and the lab directory. */
    fun labs(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): LabsStateHolder = LabsStateHolder(clinic, scope, logger("aarogyam.labs"))

    /** A new lab case for [patientId], linked to [visitId] when written inside a visit. */
    fun newLabCase(
        clinic: ClinicContext,
        patientId: String,
        visitId: String?,
        scope: CoroutineScope,
    ): NewLabCaseStateHolder = NewLabCaseStateHolder(clinic, patientId, visitId, scope, logger("aarogyam.labs"))

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
         * [logSink] (tests pass a `MemoryLogSink`). [preferences] and [dictation] are the platform's
         * (in memory and none by default).
         */
        suspend fun create(
            config: AppConfig,
            store: SecureStore,
            scope: CoroutineScope,
            network: NetworkMonitor = NetworkMonitor.AlwaysOnline,
            engine: HttpClientEngine = platformHttpEngine(),
            clock: Clock = Clock.System,
            logSink: LogSink = platformLogSink(),
            preferences: Preferences = MemoryPreferences(),
            dictation: Dictation = Dictation.None,
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
            val graph =
                AppGraph(
                    config,
                    scope,
                    HttpClientFactory(settings, engine, network, clock),
                    sessions,
                    logger,
                    preferences,
                    dictation,
                )
            scope.launch { sessions.restore() }
            return graph
        }
    }
}
