package com.aarogyam.staff.walkin

import com.aarogyam.staff.clinic.ClinicContext
import kotlinx.coroutines.CoroutineScope

/** The v10 intake form (online-only, files enqueued after create). Placeholder until T3 builds it; T3 owns this file. */
interface IntakeFormHolder

private object NoIntakeForm : IntakeFormHolder

@Suppress("UNUSED_PARAMETER")
internal fun createIntakeForm(
    clinic: ClinicContext,
    scope: CoroutineScope,
): IntakeFormHolder = NoIntakeForm
