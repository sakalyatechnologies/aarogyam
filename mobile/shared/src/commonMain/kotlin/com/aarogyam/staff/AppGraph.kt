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
import com.aarogyam.staff.consents.ConsentsStateHolder
import com.aarogyam.staff.desk.AvailabilityHolder
import com.aarogyam.staff.desk.DeskLookupStateHolder
import com.aarogyam.staff.desk.WaitTimerHolder
import com.aarogyam.staff.desk.createAvailability
import com.aarogyam.staff.desk.createWaitTimer
import com.aarogyam.staff.device.Dictation
import com.aarogyam.staff.device.MemoryPreferences
import com.aarogyam.staff.device.Preferences
import com.aarogyam.staff.expenses.ExpensesStateHolder
import com.aarogyam.staff.files.FilesStateHolder
import com.aarogyam.staff.history.VisitDetailStateHolder
import com.aarogyam.staff.history.VisitHistoryStateHolder
import com.aarogyam.staff.labs.LabsStateHolder
import com.aarogyam.staff.labs.NewLabCaseStateHolder
import com.aarogyam.staff.live.SseLiveUpdates
import com.aarogyam.staff.nav.HomeChoiceHolder
import com.aarogyam.staff.nav.createHomeChoice
import com.aarogyam.staff.notes.PatientNotesStateHolder
import com.aarogyam.staff.outbox.AudioSender
import com.aarogyam.staff.outbox.Connectivity
import com.aarogyam.staff.outbox.MemoryOutboxFiles
import com.aarogyam.staff.outbox.MemoryOutboxStore
import com.aarogyam.staff.outbox.OutboxFiles
import com.aarogyam.staff.outbox.OutboxKind
import com.aarogyam.staff.outbox.OutboxRunner
import com.aarogyam.staff.outbox.OutboxSender
import com.aarogyam.staff.outbox.OutboxStore
import com.aarogyam.staff.outbox.PatientFileSender
import com.aarogyam.staff.outbox.SendResult
import com.aarogyam.staff.outbox.SignOutResult
import com.aarogyam.staff.outbox.VisitWriteSender
import com.aarogyam.staff.outbox.WriteQueue
import com.aarogyam.staff.outbox.asConnectivity
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
import com.aarogyam.staff.tasks.MyTasksHolder
import com.aarogyam.staff.tasks.createMyTasks
import com.aarogyam.staff.team.BadgesStateHolder
import com.aarogyam.staff.team.ChatListStateHolder
import com.aarogyam.staff.team.ChatThreadStateHolder
import com.aarogyam.staff.team.InboxStateHolder
import com.aarogyam.staff.team.NotificationsStateHolder
import com.aarogyam.staff.team.StockStateHolder
import com.aarogyam.staff.team.TeamStateHolder
import com.aarogyam.staff.today.TodayStateHolder
import com.aarogyam.staff.visit.FinishVisitHolder
import com.aarogyam.staff.visit.VisitStateHolder
import com.aarogyam.staff.visit.createFinishVisit
import com.aarogyam.staff.walkin.IntakeFormHolder
import com.aarogyam.staff.walkin.WalkInStateHolder
import com.aarogyam.staff.walkin.createIntakeForm
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChangedBy
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
    /** Whether the phone has a network; the outbox sends only while it does. */
    val connectivity: Connectivity,
    /** Writes saved on the phone, waiting to be sent. */
    outboxStore: OutboxStore,
    /** Images of unsent photo uploads, in protected storage beside the queue. */
    private val outboxFiles: OutboxFiles,
    private val clock: Clock,
    /** False keeps the event stream off (tests that count requests); the apps leave it on. */
    liveStream: Boolean = true,
) {
    private val clients = mutableMapOf<BaseUrl, HttpClient>()

    /** The person's clinics and the open one. */
    val directory: ClinicDirectory =
        ClinicDirectory(Hosts(config), ::clientFor, logger("aarogyam.clinics"))

    /** Restoring, signed out or signed in. */
    val sessionState: StateFlow<SessionState> get() = sessions.state

    private val senders = mutableMapOf<OutboxKind, OutboxSender>()

    /**
     * The one offline write queue: saved on the device, sent when online, never twice (the entry id
     * is the idempotency key). Exposes `pending` and `failed` for the "Saved, will send" badge.
     * Started when the graph is built and again at every sign-in; on sign-out it is stopped and
     * emptied, so unsent writes of the previous person never go out under the next person's session.
     * That includes a session that ended by itself (refresh rejected): those writes are dropped too.
     */
    val outbox: OutboxRunner =
        OutboxRunner(
            store = outboxStore,
            // A kind nobody registered a sender for waits (it is not rejected), so no write is lost.
            sender = { entry -> senders[entry.kind]?.send(entry) ?: SendResult.Retry("no_sender") },
            connectivity = connectivity,
            now = { clock.now().toEpochMilliseconds() },
            files = outboxFiles,
        )

    /** Saves visit notes, procedures, close and photos for later; the holders use it when offline. */
    val writes: WriteQueue = WriteQueue(outbox, outboxFiles, connectivity)

    /**
     * Reload signals for screens: the server's event stream while signed in with a clinic open (stopped
     * at sign-out and on a clinic switch, polling alone when the server refuses it), plus the poll.
     */
    val live: SseLiveUpdates = SseLiveUpdates(logger("aarogyam.live"))

    private var outboxJob: Job? = null

    init {
        val visitWrites = VisitWriteSender(directory::opened, outboxFiles)
        listOf(
            OutboxKind.Note,
            OutboxKind.NoteEdit,
            OutboxKind.NoteSign,
            OutboxKind.Procedure,
            OutboxKind.VisitClose,
            OutboxKind.Photo,
        ).forEach { senders[it] = visitWrites }
        // v10 kinds: stubs that keep their entries waiting until T3 and T5 fill the sender files.
        senders[OutboxKind.PatientFile] = PatientFileSender(directory::opened, outboxFiles)
        senders[OutboxKind.Audio] = AudioSender(directory::opened, outboxFiles)
        startOutbox()
        scope.launch {
            sessions.state.collect {
                when (it) {
                    is SessionState.SignedIn -> {
                        startOutbox()
                    }

                    // A session that ends (refresh rejected, or sign-out) drops every clinic's cached data.
                    is SessionState.SignedOut -> {
                        directory.clear()
                        endOutbox()
                    }

                    else -> {}
                }
            }
        }
        if (liveStream) {
            scope.launch {
                combine(sessions.state, directory.current) { session, clinic ->
                    clinic.takeIf { session is SessionState.SignedIn }
                }.distinctUntilChangedBy { it?.slug }
                    .collectLatest { clinic -> if (clinic != null) live.run(clinic.api.client) }
            }
        }
        // A clinic opening may be what a waiting write needs (its API); try again now, not after backoff.
        scope.launch { directory.current.collect { if (it != null) outbox.retryNow() } }
    }

    /** Sends [kind] entries with [sender], the only place that calls the API for that kind. */
    fun registerSender(
        kind: OutboxKind,
        sender: OutboxSender,
    ) {
        senders[kind] = sender
    }

    private fun startOutbox() {
        if (outboxJob?.isActive != true) outboxJob = outbox.start(scope)
    }

    private suspend fun endOutbox() {
        outboxJob?.cancel()
        outboxJob = null
        outbox.clear()
        // Also photos no entry points to any more (a crash between save and queue).
        runCatching { outboxFiles.clear() }
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

    fun visitHistory(
        clinic: ClinicContext,
        patientId: String,
        scope: CoroutineScope,
    ): VisitHistoryStateHolder = VisitHistoryStateHolder(clinic, patientId, scope, logger("aarogyam.history"))

    fun visitDetail(
        clinic: ClinicContext,
        visitId: String,
        patientId: String,
        scope: CoroutineScope,
    ): VisitDetailStateHolder =
        VisitDetailStateHolder(clinic, visitId, patientId, scope, logger("aarogyam.visit_detail"))

    fun files(
        clinic: ClinicContext,
        patientId: String,
        scope: CoroutineScope,
    ): FilesStateHolder = FilesStateHolder(clinic, patientId, scope, logger("aarogyam.files"), writes)

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

    fun consents(
        clinic: ClinicContext,
        patientId: String,
        scope: CoroutineScope,
    ): ConsentsStateHolder = ConsentsStateHolder(clinic, patientId, scope, logger("aarogyam.consents"))

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

    fun desk(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): DeskLookupStateHolder = DeskLookupStateHolder(clinic, scope, logger("aarogyam.desk"))

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
    ): ToothSheetStateHolder =
        ToothSheetStateHolder(clinic, chart, visitId, scope, logger("aarogyam.toothsheet"), writes)

    /** Start treatment: the Visit screen, from [tokenId] when the patient is queued. */
    fun visit(
        clinic: ClinicContext,
        patientId: String,
        tokenId: String?,
        appointmentId: String?,
        scope: CoroutineScope,
    ): VisitStateHolder =
        VisitStateHolder(clinic, patientId, tokenId, appointmentId, dictation, scope, logger("aarogyam.visit"), writes)

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

    // v10 seams (plan R4): each returns a placeholder until its worker fills the create* function in its own file.
    fun homeChoice(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): HomeChoiceHolder = createHomeChoice(clinic, scope)

    fun availability(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): AvailabilityHolder = createAvailability(clinic, scope)

    fun intakeForm(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): IntakeFormHolder = createIntakeForm(clinic, scope)

    fun waitTimer(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): WaitTimerHolder = createWaitTimer(clinic, scope)

    fun finishVisit(
        clinic: ClinicContext,
        visitId: String,
        scope: CoroutineScope,
    ): FinishVisitHolder = createFinishVisit(clinic, visitId, scope)

    fun myTasks(
        clinic: ClinicContext,
        scope: CoroutineScope,
    ): MyTasksHolder = createMyTasks(clinic, scope)

    /** Restores the session again, after secure storage was unavailable. */
    fun restore() {
        scope.launch { sessions.restore() }
    }

    /**
     * Sign-out that first checks for writes not sent yet: [SignOutResult.SignOutBlocked] (and nothing
     * done) when any wait, so the screen can ask "N items not sent yet. Sign out anyway?" and then call [signOut].
     */
    fun trySignOut(): SignOutResult {
        val unsent = outbox.unsentCount()
        if (unsent > 0) return SignOutResult.SignOutBlocked(unsent)
        signOut()
        return SignOutResult.SignedOut
    }

    /** Revokes the session at Supabase and clears secure storage and the caches. Unsent writes are dropped: see [trySignOut]. */
    fun signOut() {
        scope.launch {
            sessions.signOut()
            directory.clear()
            endOutbox()
        }
    }

    private fun clientFor(base: BaseUrl): HttpClient =
        clients.getOrPut(base) { factory.create(base, tokens = sessions) }

    companion object {
        /**
         * Builds the graph and starts restoring the session. Fails only when this build has no
         * valid Supabase URL. [store] holds the session and the device ID; every log line goes to
         * [logSink] (tests pass a `MemoryLogSink`). [preferences], [dictation] and [outboxStore] are the
         * platform's (in memory and none by default; the platform passes a file-backed outbox store).
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
            outboxStore: OutboxStore = MemoryOutboxStore(),
            outboxFiles: OutboxFiles = MemoryOutboxFiles(),
            liveStream: Boolean = true,
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
                    network.asConnectivity(),
                    outboxStore,
                    outboxFiles,
                    clock,
                    liveStream,
                )
            scope.launch { sessions.restore() }
            return graph
        }
    }
}
