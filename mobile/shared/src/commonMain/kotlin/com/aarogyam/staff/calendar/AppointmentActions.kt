package com.aarogyam.staff.calendar

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.StatusChange
import com.aarogyam.staff.api.setStatus
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.today.VisitStatus
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.time.Clock
import kotlin.time.Instant

/** What the desk can do to a tapped appointment. */
enum class ApptAction { Confirm, Reschedule, Cancel, NoShow, Call }

/** Quick cancel reasons; [text] is what the server stores. */
enum class CancelReason(
    val text: String,
) {
    PatientAsked("Patient asked"),
    DoctorUnavailable("Doctor unavailable"),
    Duplicate("Duplicate"),
}

/** The actions that make sense for this appointment now; none to change it without [canWrite]. */
fun CalendarEntry.actions(
    now: Instant,
    canWrite: Boolean,
): List<ApptAction> {
    if (walkIn) return emptyList()
    val open = status == VisitStatus.Booked || status == VisitStatus.Confirmed
    return buildList {
        if (canWrite && status == VisitStatus.Booked) add(ApptAction.Confirm)
        if (canWrite && open) add(ApptAction.Reschedule)
        if (canWrite && open) add(ApptAction.Cancel)
        if (canWrite && open && startsAt != null && startsAt <= now) add(ApptAction.NoShow)
        add(ApptAction.Call)
    }
}

/** The sheet's state. */
data class ApptActionState(
    val busy: Boolean = false,
    val error: ScreenError? = null,
    /** The time is taken: ask "Book anyway?" and retry with [AppointmentActionsHolder.confirmAnyway]. */
    val askDoubleBook: Boolean = false,
    /** Set once a change went through; the sheet closes. */
    val done: ApptAction? = null,
    /** The number to dial, once looked up; the screen opens the dialler and calls [AppointmentActionsHolder.dialed]. */
    val dial: String? = null,
    /** The patient has no number on file. */
    val noPhone: Boolean = false,
)

/**
 * Confirm, cancel, no-show and call for one appointment. A change reloads the day through
 * [onChanged]. Patient details are never logged.
 */
class AppointmentActionsHolder(
    private val clinic: ClinicContext,
    private val entry: CalendarEntry,
    private val scope: CoroutineScope,
    private val onChanged: () -> Unit,
    private val log: Logger = Logger("aarogyam.appt_actions"),
    private val now: () -> Instant = { Clock.System.now() },
) {
    private val mutableState = MutableStateFlow(ApptActionState())
    val state: StateFlow<ApptActionState> = mutableState.asStateFlow()

    /** Whether the role may change appointments. */
    val canWrite: Boolean get() = WRITE in clinic.permissions

    /** What to offer for the appointment now. */
    fun actions(): List<ApptAction> = entry.actions(now(), canWrite)

    fun confirm() = change(StatusChange(status = "confirmed"), ApptAction.Confirm)

    /** Retries a confirm that hit a taken time, as a deliberate double booking. */
    fun confirmAnyway() = change(StatusChange(status = "confirmed", doubleBook = true), ApptAction.Confirm)

    fun noShow() = change(StatusChange(status = "no_show"), ApptAction.NoShow)

    /** Cancels with [reason] (trimmed, at most 200 characters); a blank reason is not sent. */
    fun cancel(reason: String) {
        val text = reason.trim().take(MAX_REASON)
        if (text.isEmpty()) return
        change(StatusChange(status = "cancelled", reason = text), ApptAction.Cancel)
    }

    fun dismissDoubleBook() = mutableState.update { it.copy(askDoubleBook = false) }

    /** Looks up the number to dial; the answer is in [ApptActionState.dial] or [ApptActionState.noPhone]. */
    fun call() {
        if (mutableState.value.busy) return
        mutableState.update { it.copy(busy = true, error = null, noPhone = false) }
        scope.launch {
            when (val answer = clinic.api.patient(entry.patientId)) {
                is Outcome.Success -> {
                    val phone = answer.value.phone?.takeIf { it.isNotBlank() }
                    mutableState.update { it.copy(busy = false, dial = phone, noPhone = phone == null) }
                }

                is Outcome.Failure -> {
                    log.warn("appt.phone_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(busy = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    fun dialed() = mutableState.update { it.copy(dial = null) }

    private fun change(
        body: StatusChange,
        action: ApptAction,
    ) {
        if (!canWrite || mutableState.value.busy) return
        mutableState.update { it.copy(busy = true, error = null, askDoubleBook = false) }
        scope.launch {
            when (val answer = clinic.api.setStatus(entry.appointmentId, body)) {
                is Outcome.Success -> {
                    log.info("appt.status_changed") { code("status", body.status) }
                    mutableState.update { it.copy(busy = false, done = action) }
                    onChanged()
                }

                is Outcome.Failure -> {
                    val taken = answer.error.status == CONFLICT && answer.error.code.value == SLOT_OCCUPIED
                    log.warn("appt.status_failed") { code("error", answer.error.code.value) }
                    mutableState.update {
                        if (taken && body.doubleBook != true) {
                            it.copy(busy = false, askDoubleBook = true)
                        } else {
                            it.copy(busy = false, error = ScreenError.of(answer.error))
                        }
                    }
                }
            }
        }
    }

    internal companion object {
        const val WRITE = "appointments.write"
        const val SLOT_OCCUPIED = "slot_occupied"
        const val CONFLICT = 409
        const val MAX_REASON = 200
    }
}
