package com.aarogyam.staff.queue

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.QueueToken
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.patients.sexOf

/** A token's place in the waiting room; values the app doesn't know yet are [Unknown]. */
enum class TokenStatus(
    internal val wire: String,
) {
    Waiting("waiting"),
    InChair("in_chair"),
    Done("done"),
    Left("left"),
    Unknown(""),
    ;

    /** Still in the clinic (waiting or in the chair). */
    val active: Boolean get() = this == Waiting || this == InChair

    internal companion object {
        fun of(text: String): TokenStatus = entries.firstOrNull { it.wire == text && it != Unknown } ?: Unknown
    }
}

/** One queue row. Details are for the screen only, never for logs. */
data class QueueRow(
    val id: String,
    val tokenNumber: Int,
    val patientId: String,
    val name: String,
    val number: String,
    val ageYears: Int?,
    val sex: Sex,
    val status: TokenStatus,
    val waitMinutes: Long,
    val doctor: String?,
    /** A move or Start visit for this row is in flight. */
    val busy: Boolean = false,
)

/** A visit started from the queue; the screen opens the patient there. */
data class VisitOpened(
    val patientId: String,
    val visitId: String,
)

/** What the Queue tab draws. */
sealed interface QueueState {
    data object Loading : QueueState

    /** The role lacks `appointments.read`; nothing was requested. */
    data object NotAllowed : QueueState

    data class Failed(
        val error: ScreenError,
    ) : QueueState

    /**
     * [canMove] gates Seat, Done and Left (`appointments.write`); [canStartVisit] gates Start
     * visit (`clinical.write`). [actionError] is the last failed action, until the next one.
     */
    data class Loaded(
        val rows: List<QueueRow>,
        val canMove: Boolean,
        val canStartVisit: Boolean,
        val refreshing: Boolean = false,
        val actionError: ScreenError? = null,
    ) : QueueState {
        val waiting: List<QueueRow> get() = rows.filter { it.status.active }
        val finished: List<QueueRow> get() = rows.filter { !it.status.active }
    }
}

internal fun QueueToken.toRow() =
    QueueRow(
        id = id,
        tokenNumber = tokenNumber,
        patientId = patient.id,
        name = patient.fullName,
        number = patient.number,
        ageYears = patient.ageYears,
        sex = sexOf(patient.sex),
        status = TokenStatus.of(status),
        waitMinutes = waitMinutes,
        doctor = practitioner?.displayName,
    )
