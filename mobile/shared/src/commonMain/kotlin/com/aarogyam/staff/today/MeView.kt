package com.aarogyam.staff.today

import com.aarogyam.staff.api.model.Appointment
import com.aarogyam.staff.api.model.Expense
import com.aarogyam.staff.api.model.TeamMemberToday
import com.aarogyam.staff.api.model.TodayResponse
import kotlinx.datetime.LocalTime
import kotlinx.datetime.TimeZone

/** One working shift today, in clinic time. */
data class ShiftView(
    val starts: LocalTime,
    val ends: LocalTime,
)

/**
 * The "me" card and "My schedule": the signed-in member's own day. Found through their
 * membership's linked doctor profile; null fields mean the member is not a doctor on the calendar.
 */
data class MeView(
    val name: String,
    val roleKey: String,
    /** The doctor profile linked to this membership, or null for non-doctors. */
    val practitionerId: String?,
    /** Appointments with this doctor today, by start time (cancelled ones left out). */
    val mine: List<ScheduleItem>,
    /** How many of [mine] are not yet completed or missed. */
    val remaining: Int,
    /** Reasons of the remaining appointments, as booked ("RCT", "Scaling"), with how many of each, most first. */
    val treatments: List<TreatmentCount>,
    val shifts: List<ShiftView>,
    val onLeave: Boolean,
)

/** A booked reason and how many of the member's remaining appointments have it. */
data class TreatmentCount(
    val name: String,
    val count: Int,
)

/** Why a patient needs attention, from `/today`. */
enum class AttentionKind { LateArrival, LongWait, Other }

/** One "Needs attention" row; the patient's name is for the screen only. */
data class AttentionView(
    val kind: AttentionKind,
    val minutes: Long,
    val patientId: String,
    val patientName: String,
    val appointmentId: String?,
    val tokenId: String?,
)

internal fun TodayResponse.attentionViews(): List<AttentionView> =
    attention.map {
        AttentionView(
            kind =
                when (it.kind) {
                    "late_arrival" -> AttentionKind.LateArrival
                    "long_wait" -> AttentionKind.LongWait
                    else -> AttentionKind.Other
                },
            minutes = it.minutes,
            patientId = it.patient.id,
            patientName = it.patient.fullName,
            appointmentId = it.appointmentId,
            tokenId = it.queueTokenId,
        )
    }

/** Numbers v7 shows that the server cannot give yet; drawn as "needs server support". */
enum class TodayPreview {
    /** Month revenue target (BK-15). */
    MonthTarget,

    /** Sterilisation cycles run today (BK-16). */
    SterilisationCycles,

    /** When the day is expected to end (BK-16). */
    DayEndEstimate,
}

internal fun TodayResponse.me(
    membershipId: String,
    name: String,
    roleKey: String,
    zone: TimeZone,
    items: List<ScheduleItem>,
): MeView {
    val member: TeamMemberToday? = team.firstOrNull { it.memberId == membershipId }
    val practitionerId = member?.practitioner?.id
    val byId = appointments.associateBy(Appointment::id)
    val mine =
        if (practitionerId ==
            null
        ) {
            emptyList()
        } else {
            items.filter { byId[it.appointmentId]?.practitioner?.id == practitionerId }
        }
    val open = mine.filter { it.status !in FINISHED }
    return MeView(
        name = name,
        roleKey = roleKey,
        practitionerId = practitionerId,
        mine = mine,
        remaining = open.size,
        treatments =
            open
                .mapNotNull { it.reason?.trim()?.takeIf(String::isNotEmpty) }
                .groupingBy { it }
                .eachCount()
                .map { (name, n) -> TreatmentCount(name, n) }
                .sortedByDescending { it.count },
        shifts =
            member?.shifts.orEmpty().mapNotNull { s ->
                val a = runCatching { LocalTime.parse(s.starts) }.getOrNull()
                val b = runCatching { LocalTime.parse(s.ends) }.getOrNull()
                if (a != null && b != null) ShiftView(a, b) else null
            },
        onLeave = member?.onLeave == true,
    )
}

/** The paise spent on recorded (not voided) [expenses]. */
internal fun spentPaise(expenses: List<Expense>): Long =
    expenses.filter { it.status != "void" }.sumOf { it.amountPaise }

private val FINISHED = setOf(VisitStatus.Completed, VisitStatus.NoShow, VisitStatus.Cancelled)
