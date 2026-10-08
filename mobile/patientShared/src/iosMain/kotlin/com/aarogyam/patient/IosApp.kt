package com.aarogyam.patient

import com.aarogyam.patient.appointments.AppointmentsStateHolder
import com.aarogyam.patient.booking.BookingStateHolder
import com.aarogyam.patient.clinics.ClinicsStateHolder
import com.aarogyam.patient.config.AppConfig
import com.aarogyam.patient.home.HomeStateHolder
import com.aarogyam.patient.records.BillsStateHolder
import com.aarogyam.patient.records.PrescriptionsStateHolder
import com.aarogyam.patient.signin.SignInStateHolder
import com.sakalya.mobile.http.PathNetworkMonitor
import com.sakalya.mobile.securestorage.PlatformSecureStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime

/** The Keychain service that holds the session and the device ID. */
private const val KEYCHAIN_SERVICE = "com.aarogyam.patient"

private val appScope: CoroutineScope = MainScope()

/** Builds the graph on iOS: Keychain, `NWPathMonitor`, the unified log. Null without Supabase settings. */
suspend fun createPatientGraph(config: AppConfig): PatientGraph? =
    PatientGraph.create(config, PlatformSecureStore(KEYCHAIN_SERVICE), appScope, PathNetworkMonitor())

/** One screen's coroutine scope: the SwiftUI view that owns a state holder closes it when it goes. */
class ScreenScope {
    internal val scope: CoroutineScope = MainScope()

    /** Cancels the screen's work. */
    fun close() = scope.cancel()
}

fun PatientGraph.signIn(screen: ScreenScope): SignInStateHolder = signIn(screen.scope)

fun PatientGraph.clinics(screen: ScreenScope): ClinicsStateHolder = clinics(screen.scope)

fun PatientGraph.home(screen: ScreenScope): HomeStateHolder = home(screen.scope)

fun PatientGraph.appointments(screen: ScreenScope): AppointmentsStateHolder = appointments(screen.scope)

fun PatientGraph.booking(screen: ScreenScope): BookingStateHolder = booking(screen.scope)

fun PatientGraph.prescriptions(screen: ScreenScope): PrescriptionsStateHolder = prescriptions(screen.scope)

fun PatientGraph.bills(screen: ScreenScope): BillsStateHolder = bills(screen.scope)

/** Minutes since midnight, for formatting a clinic-local time in Swift. */
val LocalTime.minuteOfDay: Int get() = hour * MINUTES_PER_HOUR + minute

/** The ISO date (`2026-10-05`), for formatting a clinic-local date in Swift. */
val LocalDate.isoText: String get() = toString()

private const val MINUTES_PER_HOUR = 60
