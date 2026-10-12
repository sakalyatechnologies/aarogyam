package com.aarogyam.staff.desk

import com.aarogyam.staff.clinic.ClinicContext
import kotlinx.coroutines.CoroutineScope

/** Doctor availability for the desk (v10 R6). Placeholder until T2 builds it; T2 owns this file. */
interface AvailabilityHolder

private object NoAvailability : AvailabilityHolder

@Suppress("UNUSED_PARAMETER")
internal fun createAvailability(
    clinic: ClinicContext,
    scope: CoroutineScope,
): AvailabilityHolder = NoAvailability
