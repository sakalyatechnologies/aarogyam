package com.aarogyam.staff.today

import com.aarogyam.staff.api.model.Appointment
import com.aarogyam.staff.api.model.TodayMoney
import com.aarogyam.staff.api.model.TodayResponse
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/** Part of the clinic's day, for the greeting. */
enum class DayPart { Morning, Afternoon, Evening }

/** An appointment's status; values the app doesn't know yet are [Unknown]. */
enum class VisitStatus { Booked, Confirmed, Arrived, InChair, Completed, Cancelled, NoShow, Unknown }

/** What the hero card shows: who is in the chair now, or who is next. */
enum class HeroKind { Now, UpNext }

/** One schedule row. Patient details are for the screen only, never for logs. */
data class ScheduleItem(
    val appointmentId: String,
    val patientName: String,
    val patientNumber: String,
    val starts: LocalTime,
    val status: VisitStatus,
    val reason: String?,
    val room: String?,
)

/** The day's numbers shown as tiles. */
data class TodayCountsView(
    val visits: Int,
    val waiting: Int,
    val done: Int,
)

/** The money tiles, only for a role that holds `finance.view`. Amounts are paise; [upiShareBps] is basis points. */
data class MoneyView(
    val collectedPaise: Long,
    val paymentsToday: Long,
    val pendingDuesPaise: Long,
    val pendingDuesPatients: Int,
    val upiShareBps: Long,
)

internal fun TodayMoney.toView() =
    MoneyView(
        collectedPaise = collectedPaise,
        paymentsToday = paymentsToday,
        pendingDuesPaise = pendingDuesPaise,
        pendingDuesPatients = pendingDuesPatients,
        upiShareBps = upiShareBps,
    )

/** Everything the Today screen draws, in the clinic's time zone. */
data class TodayView(
    val clinicName: String,
    val memberName: String,
    val date: LocalDate,
    val dayPart: DayPart,
    val counts: TodayCountsView,
    val heroKind: HeroKind?,
    val hero: ScheduleItem?,
    val schedule: List<ScheduleItem>,
    /** Null without `finance.view`, or when the money request failed (the rest of Today still shows). */
    val money: MoneyView? = null,
)

internal fun TodayResponse.toView(
    clinicName: String,
    memberName: String,
    zone: TimeZone,
): TodayView {
    val asOf = parseInstant(asOf)?.toLocalDateTime(zone)
    val items =
        appointments
            .mapNotNull {
                it.toItem(zone)
            }.filter { it.status != VisitStatus.Cancelled }
            .sortedBy { it.starts }
    val now = items.firstOrNull { it.status == VisitStatus.InChair }
    val next = items.firstOrNull { it.status in WAITING_OR_BOOKED }
    return TodayView(
        clinicName = clinicName,
        memberName = memberName,
        date = LocalDate.parse(date),
        dayPart =
            when (asOf?.hour ?: 0) {
                in 0..<NOON -> DayPart.Morning
                in NOON..<EVENING -> DayPart.Afternoon
                else -> DayPart.Evening
            },
        counts = TodayCountsView(visits = counts.total, waiting = counts.waiting, done = counts.done),
        heroKind = if (now != null) HeroKind.Now else next?.let { HeroKind.UpNext },
        hero = now ?: next,
        schedule = items,
    )
}

private fun Appointment.toItem(zone: TimeZone): ScheduleItem? {
    val start = parseInstant(startsAt) ?: return null
    return ScheduleItem(
        appointmentId = id,
        patientName = patient.fullName,
        patientNumber = patient.number,
        starts = start.toLocalDateTime(zone).time,
        status = visitStatus(status),
        reason = reason,
        room = room,
    )
}

internal fun parseInstant(text: String): Instant? = runCatching { Instant.parse(text) }.getOrNull()

internal fun visitStatus(text: String): VisitStatus =
    when (text) {
        "booked" -> VisitStatus.Booked
        "confirmed" -> VisitStatus.Confirmed
        "arrived" -> VisitStatus.Arrived
        "in_chair" -> VisitStatus.InChair
        "completed" -> VisitStatus.Completed
        "cancelled" -> VisitStatus.Cancelled
        "no_show" -> VisitStatus.NoShow
        else -> VisitStatus.Unknown
    }

private val WAITING_OR_BOOKED = setOf(VisitStatus.Arrived, VisitStatus.Booked, VisitStatus.Confirmed)
private const val NOON = 12
private const val EVENING = 17
