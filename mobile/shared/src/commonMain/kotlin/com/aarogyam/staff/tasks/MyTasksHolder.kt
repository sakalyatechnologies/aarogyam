package com.aarogyam.staff.tasks

import com.aarogyam.staff.clinic.ClinicContext
import kotlinx.coroutines.CoroutineScope

/** The "My tasks" list. Placeholder until T6 builds it; T6 owns this package. */
interface MyTasksHolder

private object NoMyTasks : MyTasksHolder

@Suppress("UNUSED_PARAMETER")
internal fun createMyTasks(
    clinic: ClinicContext,
    scope: CoroutineScope,
): MyTasksHolder = NoMyTasks
