package com.aarogyam.staff.desk

/**
 * Where a patient is today, one vocabulary for every screen. [previewOnly] states are not sent
 * by the server yet; screens may draw them in previews but must not depend on them.
 */
enum class PatientState(
    val previewOnly: Boolean = false,
) {
    Waiting,
    Called(previewOnly = true),
    InConsult,
    InChair,
    ReadyToBill(previewOnly = true),
    Done,
    Left,
}

/**
 * Maps the server's facts to a [PatientState]. [tokenStatus] is `queue_tokens.status`
 * (`waiting`, `in_chair`, `done`, `left`; the future `called` and `ready_to_bill` are accepted),
 * [calledAt] is the token's `called_at`, [openVisit] says a clinical visit is open, and
 * [appointmentStatus] is the appointment's status, used only when there is no token.
 * Returns null when the patient is not in the clinic today (booked, confirmed, or unknown).
 */
fun patientState(
    tokenStatus: String?,
    calledAt: String? = null,
    openVisit: Boolean = false,
    appointmentStatus: String? = null,
): PatientState? =
    when (tokenStatus) {
        "left" -> PatientState.Left
        "done" -> PatientState.Done
        "ready_to_bill" -> PatientState.ReadyToBill
        "called" -> PatientState.Called
        "waiting" -> if (calledAt.isNullOrBlank()) PatientState.Waiting else PatientState.Called
        "in_chair" -> if (openVisit) PatientState.InConsult else PatientState.InChair
        else -> fromAppointment(appointmentStatus, openVisit)
    }

private fun fromAppointment(
    status: String?,
    openVisit: Boolean,
): PatientState? =
    when (status) {
        "arrived" -> PatientState.Waiting
        "in_chair" -> if (openVisit) PatientState.InConsult else PatientState.InChair
        "completed" -> PatientState.Done
        "cancelled", "no_show" -> PatientState.Left
        else -> null
    }
