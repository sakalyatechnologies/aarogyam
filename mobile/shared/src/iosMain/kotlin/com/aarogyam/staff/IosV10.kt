package com.aarogyam.staff

import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.desk.AvailabilityHolder
import com.aarogyam.staff.desk.WaitTimerHolder
import com.aarogyam.staff.nav.HomeChoiceHolder
import com.aarogyam.staff.tasks.MyTasksHolder
import com.aarogyam.staff.visit.FinishVisitHolder
import com.aarogyam.staff.walkin.IntakeFormHolder

// The v10 holders for SwiftUI, each living as long as the screen that owns [screen].

/** Which home the signed-in person gets (doctor, desk or the default). */
fun AppGraph.homeChoice(
    clinic: ClinicContext,
    screen: ScreenScope,
): HomeChoiceHolder = homeChoice(clinic, screen.scope)

/** Doctors free, with a patient or away, and chairs free or busy. */
fun AppGraph.availability(
    clinic: ClinicContext,
    screen: ScreenScope,
): AvailabilityHolder = availability(clinic, screen.scope)

/** The new-patient form: Save & queue in one request. */
fun AppGraph.intakeForm(
    clinic: ClinicContext,
    screen: ScreenScope,
): IntakeFormHolder = intakeForm(clinic, screen.scope)

/** How long each queued patient has waited for their doctor. */
fun AppGraph.waitTimer(
    clinic: ClinicContext,
    screen: ScreenScope,
): WaitTimerHolder = waitTimer(clinic, screen.scope)

/** The doctor's Wrap up for [visitId]. */
fun AppGraph.finishVisit(
    clinic: ClinicContext,
    visitId: String,
    screen: ScreenScope,
): FinishVisitHolder = finishVisit(clinic, visitId, screen.scope)

/** Today's tasks for the signed-in person. */
fun AppGraph.myTasks(
    clinic: ClinicContext,
    screen: ScreenScope,
): MyTasksHolder = myTasks(clinic, screen.scope)
