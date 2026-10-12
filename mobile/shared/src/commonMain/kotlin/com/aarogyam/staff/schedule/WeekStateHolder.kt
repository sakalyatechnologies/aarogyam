package com.aarogyam.staff.schedule

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.Appointment
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlinx.datetime.todayIn
import kotlin.time.Clock

/** One day of the week view: how busy each clinic hour is. */
data class DayDensity(
    val date: LocalDate,
    /** Appointments that day, cancelled ones left out. */
    val total: Int,
    /** Appointments starting in each hour (0–23) that day. */
    val byHour: Map<Int, Int>,
)

/** The week heat map: seven days from Monday, and the hours any of them uses. */
data class WeekView(
    val days: List<DayDensity>,
    val hours: IntRange,
    /** The most appointments in any one hour of the week, to scale the heat map. */
    val peak: Int,
)

sealed interface WeekState {
    data object Loading : WeekState

    /** The role lacks `appointments.read`. */
    data object NotAllowed : WeekState

    data class Failed(
        val error: ScreenError,
    ) : WeekState

    data class Loaded(
        val view: WeekView,
        val start: LocalDate,
    ) : WeekState
}

/** The Schedule tab's Week view: one `GET /appointments` for Monday to Sunday. */
class WeekStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.week"),
    private val today: () -> LocalDate = { Clock.System.todayIn(clinic.timeZone) },
) {
    private val mutableState = MutableStateFlow<WeekState>(WeekState.Loading)

    val state: StateFlow<WeekState> = mutableState.asStateFlow()

    private var start: LocalDate = mondayOf(today())

    init {
        if (APPOINTMENTS_READ in clinic.permissions) load() else mutableState.value = WeekState.NotAllowed
    }

    fun next() = show(start.plus(DatePeriod(days = DAYS)))

    fun previous() = show(start.minus(DatePeriod(days = DAYS)))

    fun thisWeek() = show(mondayOf(today()))

    fun refresh() = load()

    private fun show(monday: LocalDate) {
        if (mutableState.value == WeekState.NotAllowed) return
        start = monday
        load()
    }

    private fun load() {
        val from = start
        mutableState.value = WeekState.Loading
        scope.launch {
            val to = from.plus(DatePeriod(days = DAYS - 1))
            mutableState.value =
                when (val answer = clinic.api.appointments(from.toString(), to.toString())) {
                    is Outcome.Success -> {
                        WeekState.Loaded(weekOf(from, answer.value.items, clinic.timeZone), from)
                    }

                    is Outcome.Failure -> {
                        log.warn("week.load_failed") { code("error", answer.error.code.value) }
                        WeekState.Failed(ScreenError.of(answer.error))
                    }
                }
        }
    }

    internal companion object {
        const val APPOINTMENTS_READ = "appointments.read"
        const val DAYS = 7

        fun mondayOf(day: LocalDate): LocalDate =
            day.minus(
                DatePeriod(
                    days =
                        day.dayOfWeek.ordinal - DayOfWeek.MONDAY.ordinal,
                ),
            )
    }
}

/** Counts [appointments] into the seven days from [monday], in [zone]. */
internal fun weekOf(
    monday: LocalDate,
    appointments: List<Appointment>,
    zone: TimeZone,
): WeekView {
    val starts =
        appointments
            .filter { it.status != "cancelled" }
            .mapNotNull { parseInstant(it.startsAt)?.toLocalDateTime(zone) }
    val days =
        (0 until WeekStateHolder.DAYS).map { offset ->
            val date = monday.plus(DatePeriod(days = offset))
            val those = starts.filter { it.date == date }
            DayDensity(date, those.size, those.groupingBy { it.hour }.eachCount())
        }
    val used = days.flatMap { it.byHour.keys }
    val hours =
        if (used.isEmpty()) {
            DEFAULT_HOURS
        } else {
            minOf(used.min(), DEFAULT_HOURS.first)..maxOf(used.max(), DEFAULT_HOURS.last)
        }
    return WeekView(days, hours, days.maxOfOrNull { d -> d.byHour.values.maxOrNull() ?: 0 } ?: 0)
}

private val DEFAULT_HOURS = 9..19
