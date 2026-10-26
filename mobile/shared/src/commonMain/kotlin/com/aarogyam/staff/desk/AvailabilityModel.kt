package com.aarogyam.staff.desk

import com.aarogyam.staff.api.model.QueueToken
import com.aarogyam.staff.api.model.TodayResponse
import kotlinx.datetime.LocalTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/** Where a doctor is right now (v10 R6). */
enum class DoctorAvailability { Free, WithPatient, Away }

/** Whether a chair has someone in it. */
enum class ChairAvailability { Free, Busy }

/** One doctor on the strip. [patients] is how many tokens they are seeing now. */
data class DoctorSlot(
    val id: String,
    val name: String,
    val availability: DoctorAvailability,
    val patients: Int = 0,
)

/** One chair (or room or lab) on the strip. [tokens] is how many tokens name it. */
data class ChairSlot(
    val roomId: String,
    val name: String,
    val kind: String,
    val availability: ChairAvailability,
    val tokens: Int = 0,
)

/** The desk's availability strip: doctors and chairs, in the order `/today` lists them. */
data class AvailabilityStrip(
    val doctors: List<DoctorSlot>,
    val chairs: List<ChairSlot>,
) {
    val freeDoctors: Int get() = doctors.count { it.availability == DoctorAvailability.Free }
    val freeChairs: Int get() = chairs.count { it.availability == ChairAvailability.Free }
}

private val SEEING = setOf("called", "in_chair")
private val SEATED = setOf("waiting", "called", "in_chair")

/**
 * Pure rules for the strip, from data the desk already has. [nowMinute] is the clinic-local
 * minute of the day (0..1439).
 *
 * A doctor with a token `called` or `in_chair` is [DoctorAvailability.WithPatient], even past
 * shift end or on leave, because the patient is really there. Otherwise leave, no shift, or a
 * time outside every shift (start inclusive, end exclusive) is Away, and the rest Free.
 * A chair is Busy when any token holds its `room_id` while waiting, called or in chair (done,
 * left and ready-to-bill free it), or when `ChairStatus.current` is set; a token with no room
 * marks nothing.
 */
fun availabilityOf(
    today: TodayResponse,
    tokens: List<QueueToken>,
    nowMinute: Int,
): AvailabilityStrip {
    val seeing =
        tokens
            .filter { it.status in SEEING }
            .mapNotNull { it.practitioner?.id }
            .groupingBy { it }
            .eachCount()
    val doctors =
        today.team.map { member ->
            val id = member.practitioner.id
            val busy = seeing[id] ?: 0
            val onShift = member.shifts.any { nowMinute >= minuteOf(it.starts) && nowMinute < minuteOf(it.ends) }
            val availability =
                when {
                    busy > 0 -> DoctorAvailability.WithPatient
                    member.onLeave || !onShift -> DoctorAvailability.Away
                    else -> DoctorAvailability.Free
                }
            DoctorSlot(id, member.practitioner.displayName, availability, busy)
        }
    val seated =
        tokens
            .filter { it.status in SEATED }
            .mapNotNull { it.roomId?.takeIf(String::isNotBlank) }
            .groupingBy { it }
            .eachCount()
    val chairs =
        today.chairs.map { chair ->
            val count = seated[chair.roomId] ?: 0
            val busy = count > 0 || chair.current != null
            ChairSlot(
                roomId = chair.roomId,
                name = chair.name,
                kind = chair.kind,
                availability = if (busy) ChairAvailability.Busy else ChairAvailability.Free,
                tokens = count,
            )
        }
    return AvailabilityStrip(doctors, chairs)
}

/** The clinic-local minute of the day of the `as_of` instant (the server's clock, so a skewed phone cannot lie). */
internal fun minuteOfDay(
    rfc3339: String,
    zone: TimeZone,
): Int? =
    runCatching { Instant.parse(rfc3339).toLocalDateTime(zone).time }
        .getOrNull()
        ?.let { it.hour * 60 + it.minute }

/** `HH:MM` (or `HH:MM:SS`) as minutes; unreadable text is -1 so the shift never matches. */
private fun minuteOf(hhmm: String): Int =
    runCatching { LocalTime.parse(hhmm) }
        .getOrNull()
        ?.let { it.hour * 60 + it.minute }
        ?: -1
