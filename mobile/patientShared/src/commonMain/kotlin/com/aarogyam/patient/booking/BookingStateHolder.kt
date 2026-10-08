package com.aarogyam.patient.booking

import com.aarogyam.patient.AppointmentView
import com.aarogyam.patient.ClinicTime
import com.aarogyam.patient.ClinicView
import com.aarogyam.patient.PatientDirectory
import com.aarogyam.patient.api.PatientClinicApi
import com.aarogyam.patient.api.model.PatientBooking
import com.aarogyam.patient.view
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.plus

/** A doctor the patient may pick. */
data class DoctorView(
    val id: String,
    val name: String,
    val specialty: String?,
)

/** A free slot: [startsAt] goes back to the API exactly as offered. */
data class SlotView(
    val startsAt: String,
    val at: ClinicTime?,
)

/** Why booking stopped. */
enum class BookingError {
    /** The clinic doesn't take bookings online. */
    BookingOff,

    /** Someone else took the slot, or too many open requests. */
    SlotTaken,
    Offline,
    Failed,
}

/**
 * Booking: the clinic (when more than one), a doctor, a day, a slot, an optional reason. The
 * doctors and slots come from the clinic's public booking reads; the booking itself goes to the
 * clinic's host for the patient's linked record, under the clinic's online booking rules.
 */
data class BookingState(
    val clinics: List<ClinicView> = emptyList(),
    val clinicId: String? = null,
    val doctors: List<DoctorView> = emptyList(),
    val doctorId: String? = null,
    val days: List<LocalDate> = emptyList(),
    val day: LocalDate? = null,
    val slots: List<SlotView> = emptyList(),
    val slot: String? = null,
    val reason: String = "",
    val loading: Boolean = true,
    val booking: Boolean = false,
    val autoConfirm: Boolean = false,
    val error: BookingError? = null,
    val booked: AppointmentView? = null,
)

/** The booking flow's state holder. */
class BookingStateHolder(
    private val directory: PatientDirectory,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.patient.booking"),
) {
    private val mutableState = MutableStateFlow(BookingState())
    private var slotsJob: Job? = null

    /** The current screen state. */
    val state: StateFlow<BookingState> = mutableState.asStateFlow()

    init {
        scope.launch {
            val clinics =
                (directory.load() as? Outcome.Success)
                    ?.value
                    ?.clinics
                    ?.map { it.view() }
                    .orEmpty()
            mutableState.update { it.copy(clinics = clinics, loading = false) }
            clinics.singleOrNull()?.let { selectClinic(it.id) }
        }
    }

    /** Picks the clinic and loads its doctors. */
    fun selectClinic(clinicId: String) {
        mutableState.update { BookingState(clinics = it.clinics, clinicId = clinicId, loading = true) }
        scope.launch {
            val api = api(clinicId) ?: return@launch fail(BookingError.Failed)
            when (val options = api.bookingOptions()) {
                is Outcome.Success -> {
                    val body = options.value
                    if (!body.enabled || body.doctors.isEmpty()) return@launch fail(BookingError.BookingOff)
                    val today =
                        runCatching { LocalDate.parse(body.today) }.getOrNull()
                            ?: return@launch fail(BookingError.Failed)
                    val days =
                        (
                            0 until
                                body.horizonDays.coerceIn(
                                    1,
                                    MAX_DAYS,
                                )
                        ).map { today.plus(DatePeriod(days = it)) }
                    mutableState.update {
                        it.copy(
                            loading = false,
                            doctors = body.doctors.map { d -> DoctorView(d.id, d.name, d.specialty) },
                            days = days,
                            autoConfirm = body.autoConfirm,
                        )
                    }
                    body.doctors.singleOrNull()?.let { selectDoctor(it.id) }
                }

                is Outcome.Failure -> {
                    fail(
                        if (options.error.kind ==
                            ApiErrorKind.NotFound
                        ) {
                            BookingError.BookingOff
                        } else {
                            BookingError.Failed
                        },
                    )
                }
            }
        }
    }

    /** Picks the doctor; the first day's slots load. */
    fun selectDoctor(doctorId: String) {
        mutableState.update { it.copy(doctorId = doctorId, slot = null, slots = emptyList(), error = null) }
        mutableState.value.days
            .firstOrNull()
            ?.let(::selectDay)
    }

    /** Picks the day and loads its free slots. */
    fun selectDay(day: LocalDate) {
        val current = mutableState.value
        val clinicId = current.clinicId ?: return
        val doctorId = current.doctorId ?: return
        mutableState.update { it.copy(day = day, slot = null, slots = emptyList(), loading = true, error = null) }
        slotsJob?.cancel()
        slotsJob =
            scope.launch {
                val api = api(clinicId) ?: return@launch fail(BookingError.Failed)
                when (val free = api.availability(day.toString(), doctorId)) {
                    is Outcome.Success -> {
                        mutableState.update {
                            it.copy(
                                loading = false,
                                slots =
                                    free.value.slots.map { s ->
                                        SlotView(s, ClinicTime.parse(s))
                                    },
                            )
                        }
                    }

                    is Outcome.Failure -> {
                        fail(BookingError.Failed)
                    }
                }
            }
    }

    fun selectSlot(startsAt: String) = mutableState.update { it.copy(slot = startsAt, error = null) }

    fun onReasonChange(text: String) = mutableState.update { it.copy(reason = text.take(REASON_MAX)) }

    /** Books the chosen slot. */
    fun book() {
        val current = mutableState.value
        if (current.booking) return
        val clinicId = current.clinicId ?: return
        val doctorId = current.doctorId ?: return
        val slot = current.slot ?: return
        mutableState.update { it.copy(booking = true, error = null) }
        scope.launch {
            val api = api(clinicId) ?: return@launch fail(BookingError.Failed)
            val reason = current.reason.trim().ifEmpty { null }
            when (val booked = api.book(PatientBooking(practitionerId = doctorId, startsAt = slot, reason = reason))) {
                is Outcome.Success -> {
                    log.info("appointment.booked") { id("appointment", booked.value.id) }
                    val name =
                        current.clinics
                            .firstOrNull { it.id == clinicId }
                            ?.name
                            .orEmpty()
                    mutableState.update { it.copy(booking = false, booked = booked.value.view { name }) }
                }

                is Outcome.Failure -> {
                    val error =
                        when (booked.error.kind) {
                            ApiErrorKind.Conflict -> BookingError.SlotTaken
                            ApiErrorKind.Transport -> BookingError.Offline
                            ApiErrorKind.NotFound -> BookingError.BookingOff
                            else -> BookingError.Failed
                        }
                    mutableState.update { it.copy(booking = false, error = error) }
                    if (error ==
                        BookingError.SlotTaken
                    ) {
                        current.day?.let(::selectDay)?.also { mutableState.update { it.copy(error = error) } }
                    }
                }
            }
        }
    }

    private suspend fun api(clinicId: String): PatientClinicApi? =
        (directory.load() as? Outcome.Success)
            ?.value
            ?.clinics
            ?.firstOrNull { it.clinicId == clinicId }
            ?.let(directory::clinicApi)

    private fun fail(error: BookingError) =
        mutableState.update { it.copy(loading = false, booking = false, error = error) }

    private companion object {
        const val MAX_DAYS = 14
        const val REASON_MAX = 200
    }
}
