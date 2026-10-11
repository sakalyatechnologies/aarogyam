package com.aarogyam.staff

import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.desk.DeskBoardStateHolder
import com.aarogyam.staff.desk.DeskLookupStateHolder
import com.aarogyam.staff.desk.DeskPaymentStateHolder
import com.sakalya.mobile.core.Logger

// The v9 front desk's holders, living as long as the SwiftUI screen that owns [screen].

/** The desk lookup by mobile number. */
fun AppGraph.deskLookup(
    clinic: ClinicContext,
    screen: ScreenScope,
): DeskLookupStateHolder = desk(clinic, screen.scope)

/** The waiting-room board, grouped by patient state. */
fun AppGraph.deskBoard(
    clinic: ClinicContext,
    screen: ScreenScope,
): DeskBoardStateHolder = DeskBoardStateHolder(clinic, screen.scope, Logger("aarogyam.deskboard"))

/** Collect payment for one patient; unsent payments go through the desk outbox. */
fun AppGraph.deskPayment(
    clinic: ClinicContext,
    patientId: String,
    screen: ScreenScope,
): DeskPaymentStateHolder = DeskPaymentStateHolder(clinic, patientId, screen.scope, this, Logger("aarogyam.deskpay"))
