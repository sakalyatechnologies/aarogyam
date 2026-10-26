package com.aarogyam.staff.config.caps

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.Json

/** The server features that ship behind a flag (plan v10 R1); every flag is off until a real response shows its field. */
data class CapsSnapshot(
    /** `family_group` came back from the phone lookup. */
    val family: Boolean = false,
    /** A payment answer carried `attachment_id`. */
    val paymentProof: Boolean = false,
    /** A notification carried `audience` / `handled`. */
    val notificationAudience: Boolean = false,
    /** A walk-in answer carried `reason`. */
    val walkInReason: Boolean = false,
    /** The spec has the queue Remind call. */
    val queueRemind: Boolean = false,
    /** A message carried `status`. */
    val messageStatus: Boolean = false,
)

/**
 * Runtime capability flags. The hand-written DTOs in this package decode the flagged fields; a
 * flag turns on through its `mark*` call when the field shows up in a real response and never
 * turns off again in a session. UI for a flagged feature stays hidden while its flag is off.
 */
object ServerCaps {
    private val mutable = MutableStateFlow(CapsSnapshot())

    val state: StateFlow<CapsSnapshot> = mutable.asStateFlow()

    val family: Boolean get() = mutable.value.family
    val paymentProof: Boolean get() = mutable.value.paymentProof
    val notificationAudience: Boolean get() = mutable.value.notificationAudience
    val walkInReason: Boolean get() = mutable.value.walkInReason
    val queueRemind: Boolean get() = mutable.value.queueRemind
    val messageStatus: Boolean get() = mutable.value.messageStatus

    fun markFamily() = mutable.update { it.copy(family = true) }

    fun markPaymentProof() = mutable.update { it.copy(paymentProof = true) }

    fun markNotificationAudience() = mutable.update { it.copy(notificationAudience = true) }

    fun markWalkInReason() = mutable.update { it.copy(walkInReason = true) }

    fun markQueueRemind() = mutable.update { it.copy(queueRemind = true) }

    fun markMessageStatus() = mutable.update { it.copy(messageStatus = true) }

    /** Clears every flag; for tests and for signing out. */
    fun reset() {
        mutable.value = CapsSnapshot()
    }
}

/** The Json for the flagged DTOs: unknown keys are fine, so a newer server never breaks the phone. */
internal val capsJson = Json { ignoreUnknownKeys = true }
