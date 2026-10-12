package com.aarogyam.staff.nav

import com.aarogyam.staff.clinic.ClinicContext
import kotlinx.coroutines.CoroutineScope

/** Picks the home tab by permission (v10 R13). Placeholder until T1 builds it; T1 owns this file. */
interface HomeChoiceHolder

private object NoHomeChoice : HomeChoiceHolder

@Suppress("UNUSED_PARAMETER")
internal fun createHomeChoice(
    clinic: ClinicContext,
    scope: CoroutineScope,
): HomeChoiceHolder = NoHomeChoice
