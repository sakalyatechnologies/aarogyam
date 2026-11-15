package com.aarogyam.staff.android.ui.desk

import com.aarogyam.staff.desk.NO_REPLY_AFTER_SECONDS
import com.aarogyam.staff.desk.PatientState
import com.sakalya.mobile.designcompose.SkTone
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.time.Instant

// Pure desk rules, ported from the iOS DeskV9Logic and DeskV10Logic so they can be unit tested.

/** The mobile field: what is typed, what is searched, what is shown. */
object DeskPhone {
    const val LENGTH = 10

    /** The national digits of whatever was typed or pasted: a pasted `+91` or trunk `0` is removed; at most ten digits. */
    fun digits(typed: String): String {
        var digits = typed.filter { it in '0'..'9' }
        if (digits.length == LENGTH + 2 && digits.startsWith("91")) digits = digits.drop(2)
        if (digits.length == LENGTH + 1 && digits.startsWith("0")) digits = digits.drop(1)
        return digits.take(LENGTH)
    }

    /** `98765 43210`: two groups of five, as the field shows them. */
    fun format(typed: String): String {
        val digits = digits(typed)
        return if (digits.length > GROUP) "${digits.take(GROUP)} ${digits.drop(GROUP)}" else digits
    }

    private const val GROUP = 5
}

enum class DeskPayProblem { Amount, Method }

/** The collect-payment form's checks and amounts. */
object DeskPay {
    private const val MAX_WHOLE = 9
    private const val PAISE = 100L
    private const val TEN = 10L

    /** Rupees typed as `1250`, `1,250` or `1250.5`, in paise; null for anything else, zero included. */
    fun paise(text: String): Long? {
        val parts = text.trim().replace(",", "").split(".")
        if (parts.size !in 1..2) return null
        val whole = parts[0]
        if (whole.isEmpty() || whole.length > MAX_WHOLE || !whole.all { it in '0'..'9' }) return null
        var cents = 0L
        if (parts.size == 2) {
            val tail = parts[1]
            if (tail.length > 2 || !tail.all { it in '0'..'9' }) return null
            cents = tail.padEnd(2, '0').toLong()
        }
        val total = whole.toLong() * PAISE + cents
        return total.takeIf { it > 0 }
    }

    /** What blocks Record: an amount not above zero, and no method chosen. */
    fun problems(
        amount: String,
        hasMethod: Boolean,
    ): List<DeskPayProblem> =
        buildList {
            if (paise(amount) == null) add(DeskPayProblem.Amount)
            if (!hasMethod) add(DeskPayProblem.Method)
        }

    /** `1250` for 125000 paise, `1250.5` for 125050: the amount field's starting text. */
    fun rupeesText(paise: Long): String {
        val whole = paise / PAISE
        val cents = paise % PAISE
        return when {
            cents == 0L -> whole.toString()
            cents % TEN == 0L -> "$whole.${cents / TEN}"
            else -> "$whole.${cents.toString().padStart(2, '0')}"
        }
    }
}

/** A doctor the desk can check a patient in with. */
data class DeskDoctor(
    val id: String,
    val name: String,
    val free: Boolean,
)

object DeskDoctors {
    /** True when the name already starts with Dr or Dr. */
    fun hasTitle(name: String): Boolean {
        val lower = name.trim().lowercase()
        return lower == "dr" || lower.startsWith("dr.") || lower.startsWith("dr ")
    }

    /**
     * Who a patient is checked in with: the doctor the desk chose, else the last doctor when they are
     * free, else any free doctor, else the last doctor (they will wait), else nobody.
     */
    fun pick(
        doctors: List<DeskDoctor>,
        lastDoctorId: String?,
        chosenId: String?,
    ): DeskDoctor? {
        doctors.firstOrNull { it.id == chosenId }?.let { return it }
        val last = doctors.firstOrNull { it.id == lastDoctorId }
        if (last != null && last.free) return last
        return doctors.firstOrNull { it.free } ?: last
    }
}

/** The waiting-room board's rules. */
object DeskBoardRules {
    /** The board's rows, top to bottom. */
    val order =
        listOf(
            PatientState.Waiting,
            PatientState.Called,
            PatientState.InConsult,
            PatientState.InChair,
            PatientState.ReadyToBill,
        )

    /** Roles that send a waiting patient in: the doctor, and the owner who is also one. */
    fun canSendIn(roleKey: String): Boolean = roleKey == "doctor" || roleKey == "owner"

    fun showsSendIn(
        roleKey: String,
        state: PatientState,
    ): Boolean = canSendIn(roleKey) && state == PatientState.Waiting

    /** The desk (who is not sending patients in) sees the "Patient called in" banner. */
    fun showsCalledBanner(
        roleKey: String,
        called: Int,
    ): Boolean = !canSendIn(roleKey) && called > 0
}

object DeskCollect {
    private const val MAY_COLLECT_SECONDS = 120

    /** Collecting needs `payments.collect`, or both bill keys. */
    fun canCollect(permissions: Set<String>): Boolean =
        "payments.collect" in permissions || ("billing.write" in permissions && "billing.read" in permissions)

    /** Remind shows to roles that may write the queue (`appointments.write` or `clinical.write`). */
    fun canRemind(permissions: Set<String>): Boolean =
        "appointments.write" in permissions || "clinical.write" in permissions

    /** A `ready_to_bill` token finished under two minutes ago: the doctor may still be collecting. Display only. */
    fun mayBeCollecting(
        endedAt: Instant?,
        now: Instant,
    ): Boolean {
        if (endedAt == null) return false
        val age = (now - endedAt).inWholeSeconds
        return age in 0 until MAY_COLLECT_SECONDS
    }
}

/** True once a waiting token has had no reply for a minute. */
fun isNoReply(seconds: Long): Boolean = seconds >= NO_REPLY_AFTER_SECONDS

enum class StripKind { DoctorsFree, WithPatient, Away, ChairsFree, ChairsBusy }

data class StripChip(
    val kind: StripKind,
    val count: Int,
    val tone: SkTone,
)

object DeskStripRules {
    /** The availability chips in order; empty groups are kept so a zero reads as zero. */
    @Suppress("LongParameterList")
    fun chips(
        doctorsFree: Int,
        withPatient: Int,
        away: Int,
        hasDoctors: Boolean,
        chairsFree: Int,
        chairsBusy: Int,
        hasChairs: Boolean,
    ): List<StripChip> =
        buildList {
            if (hasDoctors) {
                add(StripChip(StripKind.DoctorsFree, doctorsFree, SkTone.Success))
                add(StripChip(StripKind.WithPatient, withPatient, SkTone.Info))
                add(StripChip(StripKind.Away, away, SkTone.Neutral))
            }
            if (hasChairs) {
                add(StripChip(StripKind.ChairsFree, chairsFree, SkTone.Success))
                add(StripChip(StripKind.ChairsBusy, chairsBusy, SkTone.Warning))
            }
        }
}

object DeskEarlier {
    private const val COLLAPSE_ABOVE = 3

    /** More than three rows start collapsed, so the board stays the first thing on the screen. */
    fun startsCollapsed(count: Int): Boolean = count > COLLAPSE_ABOVE

    /** "12 Oct" from a clinic day `YYYY-MM-DD`; the raw text when unreadable. */
    fun dayText(
        day: String,
        locale: Locale = Locale.getDefault(),
    ): String =
        runCatching { LocalDate.parse(day).format(DateTimeFormatter.ofPattern("d MMM", locale)) }.getOrDefault(day)

    /** A clinic-local minute of the day as a short time ("9:15 AM"). */
    fun timeText(
        minute: Int,
        locale: Locale = Locale.getDefault(),
    ): String =
        LocalTime
            .ofSecondOfDay((minute.coerceIn(0, MINUTES_PER_DAY - 1) * SECONDS).toLong())
            .format(DateTimeFormatter.ofPattern("h:mm a", locale))

    private const val MINUTES_PER_DAY = 1440
    private const val SECONDS = 60
}

/** The queue notifications the server sends staff (BE4), as the bell draws them. */
object DeskAlert {
    val queueKinds = setOf("patient_waiting", "send_in", "collect_payment")

    fun isQueue(kind: String): Boolean = kind in queueKinds

    /** `#7 · SC-1042 · Dr. Patil`: the token and the clinic number, never the patient's name. */
    fun detail(
        token: Int?,
        number: String?,
        doctor: String?,
    ): String? = token?.let { listOfNotNull("#$it", number, doctor).joinToString(" · ") }
}

/** The clinic-local minute of the day of an RFC 3339 time (0 when unreadable). */
fun minuteOfDay(
    rfc3339: String,
    zoneId: String,
): Int =
    runCatching {
        val local =
            java.time.OffsetDateTime
                .parse(rfc3339)
                .atZoneSameInstant(java.time.ZoneId.of(zoneId))
        local.hour * MINUTES + local.minute
    }.getOrDefault(0)

private const val MINUTES = 60

/** Digits typed into the date box, shown as `YYYY-MM-DD` (at most 8 digits). */
fun intakeDateText(typed: String): String {
    val digits = typed.filter { it in '0'..'9' }.take(DATE_DIGITS)
    return buildString {
        digits.forEachIndexed { i, c ->
            if (i == YEAR_END || i == MONTH_END) append('-')
            append(c)
        }
    }
}

private const val DATE_DIGITS = 8
private const val YEAR_END = 4
private const val MONTH_END = 6
