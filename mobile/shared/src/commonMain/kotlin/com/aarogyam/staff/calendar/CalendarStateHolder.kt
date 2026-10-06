package com.aarogyam.staff.calendar

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.Appointment
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.today.VisitStatus
import com.aarogyam.staff.today.parseInstant
import com.aarogyam.staff.today.visitStatus
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock
import kotlin.time.Instant

/** Whether the day is split by doctor or by chair. */
enum class CalendarMode { Doctor, Chair }

/** One doctor or chair to filter by, with how many appointments it has that day. */
data class CalendarColumn(
    val id: String,
    val name: String,
    /** `#RRGGBB` for a doctor; null for a chair. */
    val colorHex: String?,
    val count: Int,
)

/** One appointment on the day. Patient details are for the screen only, never for logs. */
data class CalendarEntry(
    val appointmentId: String,
    val patientId: String,
    val patientName: String,
    val patientNumber: String,
    val starts: LocalTime,
    val ends: LocalTime,
    val status: VisitStatus,
    val reason: String?,
    val notes: String?,
    val practitionerId: String,
    val practitioner: String,
    val roomId: String?,
    val room: String?,
)

/** What the Calendar screen draws. */
sealed interface CalendarState {
    /** The role lacks `appointments.read`; nothing was requested. */
    data object NotAllowed : CalendarState

    data class Loading(
        val date: LocalDate,
    ) : CalendarState

    data class Failed(
        val date: LocalDate,
        val error: ScreenError,
    ) : CalendarState

    /**
     * [entries] are the day's appointments for the chosen [selected] column (all when null), by start.
     * [columns] are the doctors or chairs of [mode]; empty when the reference lists could not load.
     */
    data class Loaded(
        val date: LocalDate,
        val isToday: Boolean,
        val mode: CalendarMode,
        val columns: List<CalendarColumn>,
        val selected: String?,
        val entries: List<CalendarEntry>,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    ) : CalendarState
}

/**
 * The day view. One `GET /appointments` per day shown; switching between doctors and chairs or
 * filtering one column reuses that answer. Doctors and rooms come from the clinic's cached
 * reference data. Times are the clinic's, and cancelled appointments are left out.
 */
class CalendarStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.calendar"),
    private val now: () -> Instant = { Clock.System.now() },
) {
    private class Day(
        val all: List<CalendarEntry>,
        val doctors: List<CalendarColumn>,
        val chairs: List<CalendarColumn>,
    )

    private val today: LocalDate get() = now().toLocalDateTime(clinic.timeZone).date
    private val mutableState = MutableStateFlow<CalendarState>(CalendarState.Loading(today))

    /** The current screen state. */
    val state: StateFlow<CalendarState> = mutableState.asStateFlow()

    private var date: LocalDate = today
    private var mode = CalendarMode.Doctor
    private var selected: String? = null
    private var day: Day? = null
    private var job: Job? = null

    init {
        if (APPOINTMENTS_READ in clinic.permissions) load() else mutableState.value = CalendarState.NotAllowed
    }

    /** Shows [target]. */
    fun show(target: LocalDate) {
        if (mutableState.value == CalendarState.NotAllowed) return
        date = target
        selected = null
        day = null
        load()
    }

    /** The next day (swipe left). */
    fun next() = show(date.plus(DatePeriod(days = 1)))

    /** The previous day (swipe right). */
    fun previous() = show(date.plus(DatePeriod(days = -1)))

    /** Back to today. */
    fun goToToday() = show(today)

    /** Splits the day by doctor or by chair, without a request. */
    fun setMode(newMode: CalendarMode) {
        if (newMode == mode) return
        mode = newMode
        selected = null
        publish()
    }

    /** Shows one doctor or chair ([id]), or everyone when null or already selected; no request. */
    fun select(id: String?) {
        selected = if (id == selected) null else id
        publish()
    }

    /** Reloads the shown day, keeping it on screen until the answer arrives. */
    fun refresh() {
        val loaded = mutableState.value as? CalendarState.Loaded ?: return load()
        if (loaded.refreshing) return
        mutableState.value = loaded.copy(refreshing = true, error = null)
        load(keep = true)
    }

    private fun load(keep: Boolean = false) {
        job?.cancel()
        if (!keep) mutableState.value = CalendarState.Loading(date)
        val target = date
        job =
            scope.launch {
                val result = fetch(target)
                when (result) {
                    is Outcome.Success -> {
                        day = result.value
                        publish()
                    }

                    is Outcome.Failure -> {
                        log.warn("calendar.load_failed") { code("error", result.error.code.value) }
                        val error = ScreenError.of(result.error)
                        val shown = mutableState.value
                        mutableState.value =
                            if (shown is CalendarState.Loaded) {
                                shown.copy(refreshing = false, error = error)
                            } else {
                                CalendarState.Failed(target, error)
                            }
                    }
                }
            }
    }

    private suspend fun fetch(target: LocalDate) =
        coroutineScope {
            val iso = target.toString()
            val appointments = async { clinic.api.appointments(iso, iso) }
            // Reference data is a convenience: without it the day still shows, unfiltered.
            val doctors = async { clinic.reference.practitioners() }
            val rooms = async { clinic.reference.rooms() }
            when (val list = appointments.await()) {
                is Outcome.Failure -> {
                    list
                }

                is Outcome.Success -> {
                    val entries =
                        list.value.items
                            .mapNotNull { it.toEntry(clinic) }
                            .filter { it.status != VisitStatus.Cancelled }
                            .sortedBy { it.starts }
                    val doctorColumns =
                        (doctors.await() as? Outcome.Success)?.value.orEmpty().filter { it.active }.map { d ->
                            CalendarColumn(
                                d.id,
                                d.displayName,
                                d.calendarColor,
                                entries.count {
                                    it.practitionerId ==
                                        d.id
                                },
                            )
                        }
                    val chairColumns =
                        (rooms.await() as? Outcome.Success)?.value.orEmpty().filter { it.active }.map { r ->
                            CalendarColumn(r.id, r.name, null, entries.count { it.roomId == r.id })
                        }
                    Outcome.Success(Day(entries, doctorColumns, chairColumns))
                }
            }
        }

    private fun publish() {
        val current = day ?: return
        val columns = if (mode == CalendarMode.Doctor) current.doctors else current.chairs
        val chosen = selected?.takeIf { id -> columns.any { it.id == id } }
        val entries =
            when {
                chosen == null -> current.all
                mode == CalendarMode.Doctor -> current.all.filter { it.practitionerId == chosen }
                else -> current.all.filter { it.roomId == chosen }
            }
        mutableState.value = CalendarState.Loaded(date, date == today, mode, columns, chosen, entries)
    }

    private companion object {
        const val APPOINTMENTS_READ = "appointments.read"
    }
}

private fun Appointment.toEntry(clinic: ClinicContext): CalendarEntry? {
    val start = parseInstant(startsAt) ?: return null
    val end = parseInstant(endsAt) ?: start
    return CalendarEntry(
        appointmentId = id,
        patientId = patient.id,
        patientName = patient.fullName,
        patientNumber = patient.number,
        starts = start.toLocalDateTime(clinic.timeZone).time,
        ends = end.toLocalDateTime(clinic.timeZone).time,
        status = visitStatus(status),
        reason = reason,
        notes = notes,
        practitionerId = practitioner.id,
        practitioner = practitioner.displayName,
        roomId = roomId,
        room = room,
    )
}
