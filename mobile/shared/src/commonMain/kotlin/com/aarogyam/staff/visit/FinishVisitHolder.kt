package com.aarogyam.staff.visit

import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.outbox.WriteQueue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/**
 * What the Wrap up screen hands the holder, because the note and the Rx draft belong to other holders.
 * The shell builds it from the open visit screen and Rx sheet, then calls [FinishVisitHolder.attach].
 */
class FinishSources(
    val patientId: String,
    /** Saves the note still on screen (queues it offline); false when it could not be kept. */
    val saveNote: suspend () -> Boolean,
    /** Saves the Rx draft still being edited (needs the network). */
    val saveRx: suspend () -> RxSave,
    /** The draft's id now, or null when there is none. */
    val rxDraftId: () -> String?,
    /** For the offline finish; null keeps the finish online-only. */
    val writes: WriteQueue? = null,
)

/**
 * The doctor's wrap-up of one visit (plan D8, D9): follow-up chip, fee, Rx, then one finish.
 * Both buttons send `ready_to_bill`; Collect now only opens the collect sheet afterwards.
 */
interface FinishVisitHolder {
    val state: StateFlow<FinishState>

    /** Connects the note and Rx savers; call once when the screen opens, then again after the Rx draft changed. */
    fun attach(sources: FinishSources)

    fun pickFollowUp(choice: FollowUpChoice)

    /** Sets the fee in paise; null or 0 means no bill. Replaces the prefill. */
    fun setFee(paise: Long?)

    fun setIssueRx(on: Boolean)

    fun setOverrideReason(text: String)

    /** Saves the note and the Rx draft, then one finish. [collectNow] only decides the outcome. */
    fun finish(collectNow: Boolean)

    /** Goes back to editing after a failure, a refused override or "needs connection". */
    fun backToEditing()
}

internal fun createFinishVisit(
    clinic: ClinicContext,
    visitId: String,
    scope: CoroutineScope,
): FinishVisitHolder = FinishVisitStateHolder(clinic, visitId, scope)
