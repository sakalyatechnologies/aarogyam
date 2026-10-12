package com.aarogyam.staff.visit

import com.aarogyam.staff.clinic.ClinicContext
import kotlinx.coroutines.CoroutineScope

/** The doctor's wrap-up of one visit (plan D8). Placeholder until T5 builds it; T5 owns this file. */
interface FinishVisitHolder

private object NoFinishVisit : FinishVisitHolder

@Suppress("UNUSED_PARAMETER")
internal fun createFinishVisit(
    clinic: ClinicContext,
    visitId: String,
    scope: CoroutineScope,
): FinishVisitHolder = NoFinishVisit
