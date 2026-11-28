package com.aarogyam.staff.calendar

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.availability
import com.aarogyam.staff.api.model.MoveRequest
import com.aarogyam.staff.api.move
import com.aarogyam.staff.booking.BookingChoice
import com.aarogyam.staff.booking.Slot
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate
import kotlinx.datetime.toLocalDateTime

/** The Reschedule sheet: a day, a doctor and a free slot. */
data class RescheduleState(
    val doctors: List<BookingChoice> = emptyList(),
    val doctorId: String? = null,
    val date: LocalDate,
    val slots: List<Slot> = emptyList(),
    val loadingSlots: Boolean = false,
    val chosen: Slot? = null,
    val saving: Boolean = false,
    val error: ScreenError? = null,
    val moved: Boolean = false,
) {
    val canMove: Boolean get() = doctorId != null && chosen != null && !saving && !moved
}

/**
 * Moves one appointment (`POST /appointments/{id}/move`) to a free slot from `GET /public/availability`.
 * The server keeps the length and confirms in the same step.
 */
class RescheduleStateHolder(
    private val clinic: ClinicContext,
    private val entry: CalendarEntry,
    date: LocalDate,
    private val scope: CoroutineScope,
    private val onChanged: () -> Unit,
    private val log: Logger = Logger("aarogyam.reschedule"),
) {
    private val mutableState = MutableStateFlow(RescheduleState(date = date, doctorId = entry.practitionerId))
    val state: StateFlow<RescheduleState> = mutableState.asStateFlow()
    private var slotsJob: Job? = null

    init {
        scope.launch {
            val doctors = (clinic.reference.practitioners() as? Outcome.Success)?.value.orEmpty()
            mutableState.update { s ->
                s.copy(doctors = doctors.filter { it.active }.map { BookingChoice(it.id, it.displayName) })
            }
        }
        loadSlots()
    }

    fun chooseDoctor(id: String) {
        mutableState.update { it.copy(doctorId = id, chosen = null) }
        loadSlots()
    }

    fun chooseDate(date: LocalDate) {
        mutableState.update { it.copy(date = date, chosen = null) }
        loadSlots()
    }

    fun chooseSlot(slot: Slot) = mutableState.update { it.copy(chosen = slot, error = null) }

    fun move() {
        val s = mutableState.value
        val doctor = s.doctorId ?: return
        val slot = s.chosen ?: return
        if (!s.canMove) return
        mutableState.update { it.copy(saving = true, error = null) }
        scope.launch {
            val body =
                MoveRequest(
                    startsAt = slot.starts.toString(),
                    practitionerId = doctor.takeIf { it != entry.practitionerId },
                )
            when (val answer = clinic.api.move(entry.appointmentId, body)) {
                is Outcome.Success -> {
                    log.info("appt.moved")
                    mutableState.update { it.copy(saving = false, moved = true) }
                    onChanged()
                }

                is Outcome.Failure -> {
                    log.warn("appt.move_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(saving = false, error = ScreenError.of(answer.error)) }
                    loadSlots()
                }
            }
        }
    }

    private fun loadSlots() {
        val s = mutableState.value
        val doctor = s.doctorId ?: return
        slotsJob?.cancel()
        mutableState.update { it.copy(loadingSlots = true) }
        slotsJob =
            scope.launch {
                when (val answer = clinic.api.availability(s.date, doctor)) {
                    is Outcome.Success -> {
                        val slots =
                            answer.value.slots.mapNotNull { text ->
                                parseInstant(text)?.let { Slot(it, it.toLocalDateTime(clinic.timeZone).time) }
                            }
                        mutableState.update { it.copy(loadingSlots = false, slots = slots) }
                    }

                    is Outcome.Failure -> {
                        log.warn("appt.slots_failed") { code("error", answer.error.code.value) }
                        mutableState.update {
                            it.copy(loadingSlots = false, slots = emptyList(), error = ScreenError.of(answer.error))
                        }
                    }
                }
            }
    }
}
