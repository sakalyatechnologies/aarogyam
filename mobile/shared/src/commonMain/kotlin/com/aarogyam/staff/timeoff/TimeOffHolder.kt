package com.aarogyam.staff.timeoff

import com.aarogyam.staff.LiveUpdates
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.NewTimeOff
import com.aarogyam.staff.api.model.TimeOff
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlinx.datetime.todayIn
import kotlin.time.Clock
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Instant

enum class TimeOffKind(
    val key: String,
) {
    Vacation("vacation"),
    Sick("sick"),
    Personal("personal"),
    Other("other"),
    ;

    companion object {
        fun of(key: String?): TimeOffKind? = entries.firstOrNull { it.key == key }
    }
}

enum class TimeOffStatus {
    Pending,
    Approved,
    Declined,
    Cancelled,
    ;

    companion object {
        fun of(key: String): TimeOffStatus =
            when (key) {
                "approved" -> Approved
                "declined" -> Declined
                "cancelled" -> Cancelled
                else -> Pending
            }
    }
}

/** One request as the list draws it. [startsAt] and [endsAt] are RFC 3339; [endsAt] is exclusive. */
data class TimeOffRow(
    val id: String,
    /** Only on someone else's request, and only a manager sees those. */
    val memberName: String?,
    val kind: TimeOffKind?,
    val startsAt: String,
    val endsAt: String,
    /** The first and last day away (`YYYY-MM-DD`, the last one included) in the clinic's zone. */
    val firstDay: String,
    val lastDay: String,
    val allDay: Boolean,
    val status: TimeOffStatus,
    val reason: String?,
    val decisionNote: String?,
    /** An action on this row was sent and the server has not answered. */
    val busy: Boolean,
    /** The last action on this row failed. */
    val error: ScreenError?,
) {
    /** The requester may withdraw a request that is pending or approved. */
    val canCancel: Boolean get() = status == TimeOffStatus.Pending || status == TimeOffStatus.Approved
}

data class TimeOffState(
    val loading: Boolean = true,
    /** The role holds `time_off.manage`: [pending] is filled and a request can be decided. */
    val canManage: Boolean = false,
    /** The caller's own requests, newest start first. */
    val mine: List<TimeOffRow> = emptyList(),
    /** Others' requests waiting for a decision (managers only), oldest start first. */
    val pending: List<TimeOffRow> = emptyList(),
    /** A new request is being sent. */
    val sending: Boolean = false,
    /** The last new request failed. */
    val error: ScreenError? = null,
    /** The list failed to load and nothing was loaded before. */
    val loadError: ScreenError? = null,
    /** Counts up each time a new request was accepted; the sheet closes on it. */
    val sent: Int = 0,
)

/**
 * Time off: the caller's requests, and for `time_off.manage` the others' pending ones to approve or
 * decline. A change shows after the server says yes, then the list is read again.
 */
interface TimeOffHolder {
    val state: StateFlow<TimeOffState>

    fun refresh()

    fun observe(live: LiveUpdates)

    /**
     * Asks for whole days off for the caller; [firstDay] and [lastDay] are `YYYY-MM-DD`, the last one
     * included. [reason] is trimmed and sent only when not blank.
     */
    fun request(
        kind: TimeOffKind,
        firstDay: String,
        lastDay: String,
        reason: String?,
    )

    fun cancel(id: String)

    fun approve(
        id: String,
        note: String?,
    )

    fun decline(
        id: String,
        note: String?,
    )
}

internal const val TIME_OFF_TEXT_MAX = 200

/** The list covers today and the 41 days after (the server's 42-day limit). */
private const val SPAN_DAYS = 41

private const val DATE_CHARS = 10

private class TimeOffStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val today: () -> LocalDate,
    private val log: Logger = Logger("aarogyam.timeoff"),
) : TimeOffHolder {
    private val manage = "time_off.manage" in clinic.permissions
    private val allowed = manage || "time_off.request" in clinic.permissions
    private val me = clinic.session.membership.id
    private val mutable = MutableStateFlow(TimeOffState(loading = allowed, canManage = manage))
    override val state: StateFlow<TimeOffState> = mutable.asStateFlow()

    private var items: List<TimeOff> = emptyList()
    private var loaded = false
    private var loading = false
    private var sending = false
    private var error: ScreenError? = null
    private var sent = 0
    private val busy = mutableSetOf<String>()
    private val errors = mutableMapOf<String, ScreenError>()

    init {
        refresh()
    }

    override fun refresh() {
        if (!allowed || loading) return
        loading = true
        scope.launch {
            try {
                load()
            } finally {
                loading = false
            }
        }
    }

    override fun observe(live: LiveUpdates) {
        scope.launch { live.changes().collect { refresh() } }
    }

    override fun request(
        kind: TimeOffKind,
        firstDay: String,
        lastDay: String,
        reason: String?,
    ) {
        val first = runCatching { LocalDate.parse(firstDay) }.getOrNull()
        val last = runCatching { LocalDate.parse(lastDay) }.getOrNull()
        if (!allowed || sending || first == null || last == null || last < first) return
        sending = true
        error = null
        publish()
        val body =
            NewTimeOff(
                kind = kind.key,
                firstDay = first.toString(),
                lastDay = last.toString(),
                reason = clean(reason),
            )
        scope.launch {
            when (val answer = clinic.api.requestTimeOff(body)) {
                is Outcome.Success -> {
                    sending = false
                    sent++
                    items = items.filterNot { it.id == answer.value.id } + answer.value
                    publish()
                    refresh()
                }

                is Outcome.Failure -> {
                    log.warn("timeoff.request_failed") { code("error", answer.error.code.value) }
                    sending = false
                    error = ScreenError.of(answer.error)
                    publish()
                }
            }
        }
    }

    override fun cancel(id: String) = act(id) { clinic.api.cancelTimeOff(id) }

    override fun approve(
        id: String,
        note: String?,
    ) = act(id) { clinic.api.approveTimeOff(id, clean(note)) }

    override fun decline(
        id: String,
        note: String?,
    ) = act(id) { clinic.api.declineTimeOff(id, clean(note)) }

    private fun clean(text: String?) = text?.trim()?.take(TIME_OFF_TEXT_MAX)?.ifEmpty { null }

    private fun act(
        id: String,
        call: suspend () -> Outcome<TimeOff, ApiError>,
    ) {
        if (!allowed || id in busy || items.none { it.id == id }) return
        busy += id
        errors.remove(id)
        publish()
        scope.launch {
            when (val answer = call()) {
                is Outcome.Success -> {
                    busy -= id
                    items = items.map { if (it.id == id) answer.value else it }
                    publish()
                    refresh()
                }

                is Outcome.Failure -> {
                    log.warn("timeoff.action_failed") {
                        id("time_off", id)
                        code("error", answer.error.code.value)
                    }
                    busy -= id
                    errors[id] = ScreenError.of(answer.error)
                    publish()
                    // 409: someone else decided it first. Show the server's state.
                    if (answer.error.status == 409) refresh()
                }
            }
        }
    }

    private suspend fun load() {
        val from = today()
        val to = from.plus(DatePeriod(days = SPAN_DAYS))
        when (val answer = clinic.api.listTimeOff(from.toString(), to.toString())) {
            is Outcome.Success -> {
                items = answer.value.items
                loaded = true
                errors.keys.retainAll(items.map { it.id }.toSet())
                publish()
            }

            is Outcome.Failure -> {
                if (loaded) {
                    publish()
                } else {
                    mutable.value = mutable.value.copy(loading = false, loadError = ScreenError.of(answer.error))
                }
            }
        }
    }

    private fun publish() {
        val mine = items.filter { it.membershipId == me }.sortedByDescending { it.startsAt }
        val others =
            if (manage) {
                items.filter { it.membershipId != me && it.status == "pending" }.sortedBy { it.startsAt }
            } else {
                emptyList()
            }
        mutable.value =
            TimeOffState(
                loading = false,
                canManage = manage,
                mine = mine.map { it.toRow() },
                pending = others.map { it.toRow() },
                sending = sending,
                error = error,
                sent = sent,
            )
    }

    /** The clinic's local day of [text], moved by [shift] milliseconds first (the end is exclusive). */
    private fun dayOf(
        text: String,
        shift: Long,
    ): String =
        runCatching {
            (Instant.parse(text) + shift.milliseconds).toLocalDateTime(clinic.timeZone).date.toString()
        }.getOrDefault(text.take(DATE_CHARS))

    private fun TimeOff.toRow() =
        TimeOffRow(
            id = id,
            memberName = if (membershipId == me) null else memberName,
            kind = TimeOffKind.of(kind),
            startsAt = startsAt,
            endsAt = endsAt,
            firstDay = dayOf(startsAt, 0),
            lastDay = dayOf(endsAt, -1),
            allDay = allDay,
            status = TimeOffStatus.of(status),
            reason = reason,
            decisionNote = decisionNote,
            busy = id in busy,
            error = errors[id],
        )
}

internal fun createTimeOff(
    clinic: ClinicContext,
    scope: CoroutineScope,
): TimeOffHolder = TimeOffStateHolder(clinic, scope, today = { Clock.System.todayIn(clinic.timeZone) })

internal fun createTimeOff(
    clinic: ClinicContext,
    scope: CoroutineScope,
    today: () -> LocalDate,
): TimeOffHolder = TimeOffStateHolder(clinic, scope, today)
