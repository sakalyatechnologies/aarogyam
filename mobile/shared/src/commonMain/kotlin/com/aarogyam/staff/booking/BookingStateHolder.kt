package com.aarogyam.staff.booking

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.availability
import com.aarogyam.staff.api.book
import com.aarogyam.staff.api.model.NewAppointmentBody
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
import kotlinx.datetime.LocalTime
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/** A doctor or chair chip. */
data class BookingChoice(
    val id: String,
    val label: String,
)

/** One free slot chip, in clinic time. */
data class Slot(
    val starts: Instant,
    val time: LocalTime,
)

/** Kinds of visit the clinic books, as the server names them. */
enum class VisitKind(
    val wire: String,
) {
    New("new"),
    FollowUp("follow_up"),
    Procedure("procedure"),
    Emergency("emergency"),
}

/** A warning the server attached to a booking it accepted. */
enum class BookingWarningKind { PractitionerBusy, PractitionerOnLeave, OutsideWorkingHours, Other }

/** The booking sheet. Patient details are never logged. */
data class BookingState(
    val allowed: Boolean,
    val doctors: List<BookingChoice> = emptyList(),
    val chairs: List<BookingChoice> = emptyList(),
    val doctorId: String? = null,
    val chairId: String? = null,
    val date: LocalDate,
    val kind: VisitKind = VisitKind.FollowUp,
    val reason: String = "",
    val slotMinutes: Int = DEFAULT_SLOT_MINUTES,
    val slots: List<Slot> = emptyList(),
    val loadingSlots: Boolean = false,
    val chosen: Slot? = null,
    val saving: Boolean = false,
    val error: ScreenError? = null,
    /** Set once booked: the new appointment, and any warnings to show beside the success. */
    val booked: String? = null,
    val warnings: List<BookingWarningKind> = emptyList(),
) {
    /** Whether Book can be pressed. */
    val canBook: Boolean get() = allowed && doctorId != null && chosen != null && !saving && booked == null

    internal companion object {
        const val DEFAULT_SLOT_MINUTES = 15
    }
}

/**
 * Booking a visit for [patientId]: doctors and chairs from cached reference data, free slots from
 * `GET /public/availability` (one request per doctor and day), then `POST /appointments`.
 */
class BookingStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    date: LocalDate,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.booking"),
) {
    private val mutableState =
        MutableStateFlow(BookingState(allowed = APPOINTMENTS_WRITE in clinic.permissions, date = date))
    val state: StateFlow<BookingState> = mutableState.asStateFlow()
    private var slotsJob: Job? = null

    init {
        if (mutableState.value.allowed) scope.launch { loadChoices() }
    }

    fun chooseDoctor(id: String) {
        mutableState.update { it.copy(doctorId = id, chosen = null) }
        loadSlots()
    }

    fun chooseChair(id: String?) = mutableState.update { it.copy(chairId = id) }

    fun chooseDate(date: LocalDate) {
        mutableState.update { it.copy(date = date, chosen = null) }
        loadSlots()
    }

    fun chooseSlot(slot: Slot) = mutableState.update { it.copy(chosen = slot, error = null) }

    fun chooseKind(kind: VisitKind) = mutableState.update { it.copy(kind = kind) }

    fun setReason(text: String) = mutableState.update { it.copy(reason = text.take(MAX_REASON)) }

    fun book() {
        val s = mutableState.value
        val doctor = s.doctorId ?: return
        val slot = s.chosen ?: return
        if (!s.canBook) return
        mutableState.update { it.copy(saving = true, error = null) }
        scope.launch {
            val body =
                NewAppointmentBody(
                    patientId = patientId,
                    practitionerId = doctor,
                    startsAt = slot.starts.toString(),
                    endsAt = (slot.starts + s.slotMinutes.minutes).toString(),
                    kind = s.kind.wire,
                    reason = s.reason.trim().ifEmpty { null },
                    roomId = s.chairId,
                    source = SOURCE,
                )
            when (val answer = clinic.api.book(body)) {
                is Outcome.Success -> {
                    log.info("booking.created")
                    mutableState.update {
                        it.copy(
                            saving = false,
                            booked = answer.value.appointment.id,
                            warnings =
                                answer.value.warnings.map { w ->
                                    warning(w.code)
                                },
                        )
                    }
                }

                is Outcome.Failure -> {
                    log.warn("booking.failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(saving = false, error = ScreenError.of(answer.error)) }
                    loadSlots()
                }
            }
        }
    }

    private suspend fun loadChoices() {
        val doctors = clinic.reference.practitioners()
        val rooms = clinic.reference.rooms()
        mutableState.update { s ->
            s.copy(
                doctors = (doctors as? Outcome.Success)?.value.orEmpty().map { BookingChoice(it.id, it.displayName) },
                chairs =
                    (rooms as? Outcome.Success)?.value.orEmpty().filter { it.kind == CHAIR }.map {
                        BookingChoice(
                            it.id,
                            it.name,
                        )
                    },
                error = (doctors as? Outcome.Failure)?.let { ScreenError.of(it.error) },
            )
        }
        mutableState.value.doctors
            .singleOrNull()
            ?.let { chooseDoctor(it.id) }
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
                        mutableState.update {
                            it.copy(
                                loadingSlots = false,
                                slots = slots,
                                slotMinutes = answer.value.slotMinutes,
                            )
                        }
                    }

                    is Outcome.Failure -> {
                        log.warn("booking.slots_failed") { code("error", answer.error.code.value) }
                        mutableState.update {
                            it.copy(
                                loadingSlots = false,
                                slots = emptyList(),
                                error = ScreenError.of(answer.error),
                            )
                        }
                    }
                }
            }
    }

    private fun warning(code: String) =
        when (code) {
            "practitioner_busy" -> BookingWarningKind.PractitionerBusy
            "practitioner_on_leave" -> BookingWarningKind.PractitionerOnLeave
            "outside_working_hours" -> BookingWarningKind.OutsideWorkingHours
            else -> BookingWarningKind.Other
        }

    private companion object {
        const val APPOINTMENTS_WRITE = "appointments.write"
        const val CHAIR = "chair"
        const val SOURCE = "app"
        const val MAX_REASON = 200
    }
}
