package com.aarogyam.staff

import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.consents.ConsentsStateHolder
import com.aarogyam.staff.history.VisitDetailStateHolder
import com.aarogyam.staff.history.VisitHistoryStateHolder
import com.aarogyam.staff.patients.PatientOverviewStateHolder
import com.sakalya.mobile.core.Logger

// The v9 patient page's holders, living as long as the SwiftUI screen that owns [screen].

/** The Overview tab and the header money strip. */
fun AppGraph.patientOverview(
    clinic: ClinicContext,
    patientId: String,
    screen: ScreenScope,
): PatientOverviewStateHolder = PatientOverviewStateHolder(clinic, patientId, screen.scope, Logger("aarogyam.overview"))

/** The History tab. */
fun AppGraph.visitHistory(
    clinic: ClinicContext,
    patientId: String,
    screen: ScreenScope,
): VisitHistoryStateHolder = visitHistory(clinic, patientId, screen.scope)

/** One past visit's detail. */
fun AppGraph.visitDetail(
    clinic: ClinicContext,
    visitId: String,
    patientId: String,
    screen: ScreenScope,
): VisitDetailStateHolder = visitDetail(clinic, visitId, patientId, screen.scope)

/** The Consent tab. */
fun AppGraph.consents(
    clinic: ClinicContext,
    patientId: String,
    screen: ScreenScope,
): ConsentsStateHolder = consents(clinic, patientId, screen.scope)
