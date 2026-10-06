package com.aarogyam.staff

import com.aarogyam.staff.calendar.CalendarStateHolder
import com.aarogyam.staff.chart.ChartStateHolder
import com.aarogyam.staff.clinic.ClinicBranding
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.clinic.ClinicPickerStateHolder
import com.aarogyam.staff.config.AppConfig
import com.aarogyam.staff.patients.AllergyView
import com.aarogyam.staff.patients.Patient360StateHolder
import com.aarogyam.staff.patients.PatientsStateHolder
import com.aarogyam.staff.prescriptions.RxListStateHolder
import com.aarogyam.staff.prescriptions.RxSheetStateHolder
import com.aarogyam.staff.signin.SignInStateHolder
import com.aarogyam.staff.today.TodayStateHolder
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
 * log. Returns null when this build has no Supabase settings.
 */
suspend fun createAppGraph(config: AppConfig): AppGraph? =
    AppGraph.create(config, PlatformSecureStore(KEYCHAIN_SERVICE), appScope, PathNetworkMonitor())

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
