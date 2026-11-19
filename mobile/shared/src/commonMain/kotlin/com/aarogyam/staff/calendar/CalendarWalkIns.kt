package com.aarogyam.staff.calendar

import com.aarogyam.staff.api.model.CalendarWalkIn
import com.aarogyam.staff.api.model.CalendarWalkInList
import com.aarogyam.staff.today.VisitStatus
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Duration.Companion.minutes

/** How long an open walk-in is drawn, since it has no end yet. */
internal val OPEN_WALK_IN = 30.minutes

/** The walk-ins of a range, or that they could not be loaded (the appointments still show). */
internal class WalkIns(
    val items: List<CalendarWalkIn>,
    val failed: Boolean,
)

/**
 * The answer of `GET /calendar/walk-ins`. A `404` is a server without the route yet: no walk-ins,
 * and no note, since nothing is missing.
 */
internal fun walkInsOf(answer: Outcome<CalendarWalkInList, ApiError>): WalkIns =
    when (answer) {
        is Outcome.Success -> WalkIns(answer.value.items, failed = false)
        is Outcome.Failure -> WalkIns(emptyList(), failed = answer.error.code.value != NOT_FOUND)
    }

private const val NOT_FOUND = "not_found"

/**
 * A walk-in as a calendar block. Closed looks like a completed appointment; open today like one
 * in the chair; open from an earlier day stays neutral. Open ones are [OPEN_WALK_IN] tall.
 * [CalendarEntry.appointmentId] carries the visit id; walk-ins have no appointment.
 */
internal fun CalendarWalkIn.toEntry(
    zone: TimeZone,
    today: LocalDate,
): CalendarEntry? {
    val start = parseInstant(startsAt) ?: return null
    val closed = status == "closed"
    val end = endsAt?.takeIf { closed }?.let(::parseInstant)?.takeIf { it > start } ?: (start + OPEN_WALK_IN)
    val local = start.toLocalDateTime(zone)
    return CalendarEntry(
        appointmentId = visitId,
        patientId = patient.id,
        patientName = patient.fullName,
        patientNumber = patient.number,
        starts = local.time,
        ends = end.toLocalDateTime(zone).time,
        status =
            when {
                closed -> VisitStatus.Completed
                status == "open" && local.date == today -> VisitStatus.InChair
                else -> VisitStatus.Unknown
            },
        reason = null,
        notes = null,
        practitionerId = practitioner?.id.orEmpty(),
        practitioner = practitioner?.displayName.orEmpty(),
        roomId = roomId,
        room = room,
        walkIn = true,
    )
}
