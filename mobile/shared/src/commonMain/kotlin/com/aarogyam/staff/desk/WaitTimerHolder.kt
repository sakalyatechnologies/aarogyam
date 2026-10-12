package com.aarogyam.staff.desk

import com.aarogyam.staff.clinic.ClinicContext
import kotlinx.coroutines.CoroutineScope

/** The queue wait timer and the collect race rules. Placeholder until T4 builds it; T4 owns this file. */
interface WaitTimerHolder

private object NoWaitTimer : WaitTimerHolder

@Suppress("UNUSED_PARAMETER")
internal fun createWaitTimer(
    clinic: ClinicContext,
    scope: CoroutineScope,
): WaitTimerHolder = NoWaitTimer
