package com.aarogyam.staff

import com.aarogyam.staff.analytics.AnalyticsStateHolder
import com.aarogyam.staff.billing.BillingStateHolder
import com.aarogyam.staff.booking.BookingStateHolder
import com.aarogyam.staff.calendar.CalendarStateHolder
import com.aarogyam.staff.chart.ChartStateHolder
import com.aarogyam.staff.chart.ToothSheetStateHolder
import com.aarogyam.staff.clinic.ClinicBranding
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.clinic.ClinicPickerStateHolder
import com.aarogyam.staff.config.AppConfig
import com.aarogyam.staff.device.Dictation
import com.aarogyam.staff.device.UserDefaultsPreferences
import com.aarogyam.staff.expenses.ExpensesStateHolder
import com.aarogyam.staff.files.FilesStateHolder
import com.aarogyam.staff.notes.PatientNotesStateHolder
import com.aarogyam.staff.patients.AllergyView
import com.aarogyam.staff.patients.Patient360StateHolder
import com.aarogyam.staff.patients.PatientsStateHolder
import com.aarogyam.staff.prescriptions.RxListStateHolder
import com.aarogyam.staff.prescriptions.RxSheetStateHolder
import com.aarogyam.staff.queue.QueueStateHolder
import com.aarogyam.staff.schedule.ScheduleStateHolder
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
import com.sakalya.mobile.design.ThemeMode
import com.sakalya.mobile.http.PathNetworkMonitor
import com.sakalya.mobile.securestorage.PlatformSecureStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime

/** The Keychain service that holds the session and the device ID. */
private const val KEYCHAIN_SERVICE = "com.aarogyam.staff"

/** The process-wide scope the graph and the session live in. */
private val appScope: CoroutineScope = MainScope()

/**
 * Builds the app graph on iOS: Keychain storage, `NWPathMonitor` connectivity and the unified
 * log, UserDefaults for small settings, and the Swift speech recogniser as [dictation]. Returns
 * null when this build has no Supabase settings.
 */
suspend fun createAppGraph(
    config: AppConfig,
    dictation: Dictation = Dictation.None,
): AppGraph? =
    AppGraph.create(
        config,
        PlatformSecureStore(KEYCHAIN_SERVICE),
        appScope,
        PathNetworkMonitor(),
        preferences = UserDefaultsPreferences(),
        dictation = dictation,
    )

/** One screen's coroutine scope: the SwiftUI view that owns a state holder closes it when it goes. */
class ScreenScope {
    internal val scope: CoroutineScope = MainScope()

    /** Cancels the screen's work. */
    fun close() = scope.cancel()
}

/** The sign-in state holder, living as long as [screen]. */
fun AppGraph.signIn(screen: ScreenScope): SignInStateHolder = signIn(screen.scope)

/** The clinic picker state holder, living as long as [screen]. */
fun AppGraph.clinicPicker(
    screen: ScreenScope,
    autoOpenSingle: Boolean,
): ClinicPickerStateHolder = clinicPicker(screen.scope, autoOpenSingle)

/** The Today state holder for [clinic], living as long as [screen]. */
fun AppGraph.today(
    clinic: ClinicContext,
    screen: ScreenScope,
): TodayStateHolder = today(clinic, screen.scope)

/** The Patients state holder for [clinic], living as long as [screen]. */
fun AppGraph.patients(
    clinic: ClinicContext,
    screen: ScreenScope,
): PatientsStateHolder = patients(clinic, screen.scope)

/** The Patient 360 state holder for [patientId], living as long as [screen]. */
fun AppGraph.patient360(
    clinic: ClinicContext,
    patientId: String,
    screen: ScreenScope,
): Patient360StateHolder = patient360(clinic, patientId, screen.scope)

/** The dental chart state holder for [patientId], living as long as [screen]. */
fun AppGraph.chart(
    clinic: ClinicContext,
    patientId: String,
    screen: ScreenScope,
): ChartStateHolder = chart(clinic, patientId, screen.scope)

/** The Notes tab's state holder for [patientId], living as long as [screen]. */
fun AppGraph.patientNotes(
    clinic: ClinicContext,
    patientId: String,
    screen: ScreenScope,
): PatientNotesStateHolder = patientNotes(clinic, patientId, screen.scope)

/** The Files tab's state holder for [patientId], living as long as [screen]. */
fun AppGraph.files(
    clinic: ClinicContext,
    patientId: String,
    screen: ScreenScope,
): FilesStateHolder = files(clinic, patientId, screen.scope)

/** The Rx tab's state holder for [patientId], living as long as [screen]. */
fun AppGraph.rxList(
    clinic: ClinicContext,
    patientId: String,
    screen: ScreenScope,
): RxListStateHolder = rxList(clinic, patientId, screen.scope)

/** The Rx sheet's state holder, living as long as [screen]; [allergies] come from Patient 360. */
fun AppGraph.rxSheet(
    clinic: ClinicContext,
    patientId: String,
    allergies: List<AllergyView>,
    screen: ScreenScope,
): RxSheetStateHolder = rxSheet(clinic, patientId, allergies, screen.scope)

/** The Billing tab's state holder for [patientId], living as long as [screen]. */
fun AppGraph.billing(
    clinic: ClinicContext,
    patientId: String,
    screen: ScreenScope,
): BillingStateHolder = billing(clinic, patientId, screen.scope)

/** The Calendar state holder for [clinic], living as long as [screen]. */
fun AppGraph.calendar(
    clinic: ClinicContext,
    screen: ScreenScope,
): CalendarStateHolder = calendar(clinic, screen.scope)

/** The palette for SakalyaUI's `SkPalette(tokens:)`, as `#rrggbb` text by token name. */
fun ClinicBranding.paletteTokens(systemDark: Boolean): Map<String, String> = theme(systemDark).colors.toHexMap()

/** Whether the clinic's theme is dark, given the phone's appearance. */
fun ClinicBranding.isDark(systemDark: Boolean): Boolean = theme(systemDark).mode == ThemeMode.Dark

/** Minutes since midnight, for formatting a clinic-local time in Swift. */
val LocalTime.minuteOfDay: Int get() = hour * MINUTES_PER_HOUR + minute

/** The ISO date (`2026-10-05`), for formatting a clinic-local date in Swift. */
val LocalDate.isoText: String get() = toString()

private const val MINUTES_PER_HOUR = 60

/** The Walk-in state holder for [clinic], living as long as [screen]. */
fun AppGraph.walkIn(
    clinic: ClinicContext,
    screen: ScreenScope,
): WalkInStateHolder = walkIn(clinic, screen.scope)

/** The Queue tab's state holder for [clinic], living as long as [screen]. */
fun AppGraph.queue(
    clinic: ClinicContext,
    screen: ScreenScope,
): QueueStateHolder = queue(clinic, screen.scope)

/** The Schedule tab for [clinic], living as long as [screen]. */
fun AppGraph.schedule(
    clinic: ClinicContext,
    screen: ScreenScope,
): ScheduleStateHolder = schedule(clinic, screen.scope)

/** The booking sheet for [patientId] on [date], living as long as [screen]. */
fun AppGraph.booking(
    clinic: ClinicContext,
    patientId: String,
    date: LocalDate,
    screen: ScreenScope,
): BookingStateHolder = booking(clinic, patientId, date, screen.scope)

/** The Analytics page for [clinic], living as long as [screen]. */
fun AppGraph.analytics(
    clinic: ClinicContext,
    screen: ScreenScope,
): AnalyticsStateHolder = analytics(clinic, screen.scope)

/** The Expenses page for [clinic], living as long as [screen]. */
fun AppGraph.expenses(
    clinic: ClinicContext,
    screen: ScreenScope,
): ExpensesStateHolder = expenses(clinic, screen.scope)

/** The tooth sheet's treatment form over [chart], living as long as [screen]. */
fun AppGraph.toothSheet(
    clinic: ClinicContext,
    chart: ChartStateHolder,
    visitId: String?,
    screen: ScreenScope,
): ToothSheetStateHolder = toothSheet(clinic, chart, visitId, screen.scope)

/** The Rx sheet for a prescription written inside [visitId], living as long as [screen]. */
fun AppGraph.rxSheetInVisit(
    clinic: ClinicContext,
    patientId: String,
    allergies: List<AllergyView>,
    visitId: String,
    screen: ScreenScope,
): RxSheetStateHolder = rxSheet(clinic, patientId, allergies, screen.scope, visitId)

/** Start treatment and the Visit screen, living as long as [screen]. */
fun AppGraph.visit(
    clinic: ClinicContext,
    patientId: String,
    tokenId: String?,
    appointmentId: String?,
    screen: ScreenScope,
): VisitStateHolder = visit(clinic, patientId, tokenId, appointmentId, screen.scope)

/** Joining from an invitation [link], living as long as [screen]. */
fun AppGraph.invite(
    link: String?,
    screen: ScreenScope,
): InviteStateHolder = invite(screen.scope, link)

/** "Register your clinic", living as long as [screen]. */
fun AppGraph.registration(screen: ScreenScope): RegistrationStateHolder = registration(screen.scope)

/** The team chat list, living as long as [screen]. */
fun AppGraph.chatList(
    clinic: ClinicContext,
    screen: ScreenScope,
): ChatListStateHolder = chatList(clinic, screen.scope)

/** One conversation, living as long as [screen]. */
fun AppGraph.chatThread(
    clinic: ClinicContext,
    conversationId: String,
    screen: ScreenScope,
): ChatThreadStateHolder = chatThread(clinic, conversationId, screen.scope)

/** The team list, living as long as [screen]. */
fun AppGraph.team(
    clinic: ClinicContext,
    screen: ScreenScope,
): TeamStateHolder = team(clinic, screen.scope)

/** Low stock, living as long as [screen]. */
fun AppGraph.stock(
    clinic: ClinicContext,
    screen: ScreenScope,
): StockStateHolder = stock(clinic, screen.scope)

/** The notifications sheet, living as long as [screen]. */
fun AppGraph.notifications(
    clinic: ClinicContext,
    screen: ScreenScope,
): NotificationsStateHolder = notifications(clinic, screen.scope)

/** The Messages page, living as long as [screen]. */
fun AppGraph.inbox(
    clinic: ClinicContext,
    screen: ScreenScope,
): InboxStateHolder = inbox(clinic, screen.scope)

/** Unread badges, living as long as [screen]. */
fun AppGraph.badges(
    clinic: ClinicContext,
    screen: ScreenScope,
): BadgesStateHolder = badges(clinic, screen.scope)
