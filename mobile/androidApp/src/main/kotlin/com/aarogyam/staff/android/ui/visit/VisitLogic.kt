package com.aarogyam.staff.android.ui.visit

import com.aarogyam.staff.chart.Surface
import com.aarogyam.staff.chart.TermView
import com.aarogyam.staff.prescriptions.DoseSlot
import com.aarogyam.staff.prescriptions.RX_MAX_DAYS
import com.aarogyam.staff.prescriptions.RX_MIN_DAYS
import com.aarogyam.staff.prescriptions.RxDose
import com.aarogyam.staff.prescriptions.unitsTotal
import com.aarogyam.staff.visit.Bullet
import com.aarogyam.staff.visit.BulletKind
import java.text.NumberFormat
import java.util.Locale

/** The S, O or P tag on a note bullet (as iOS `NoteTag`). */
internal object NoteTag {
    /** The next kind when the tag is tapped: Complaint, Finding, Advice, and round again. */
    fun next(kind: BulletKind): BulletKind =
        when (kind) {
            BulletKind.Complaint, BulletKind.Dictated -> BulletKind.Finding
            BulletKind.Finding -> BulletKind.Advice
            BulletKind.Advice -> BulletKind.Complaint
        }

    fun letter(kind: BulletKind): String =
        when (kind) {
            BulletKind.Complaint, BulletKind.Dictated -> "S"
            BulletKind.Finding -> "O"
            BulletKind.Advice -> "P"
        }

    /** The kind a new written bullet gets: the one before it, Complaint at the start. */
    fun kindForNew(bullets: List<Bullet>): BulletKind {
        val last = bullets.lastOrNull() ?: return BulletKind.Complaint
        return if (last.kind == BulletKind.Dictated) BulletKind.Complaint else last.kind
    }
}

/** A dose total as the course needs it: [count] pieces, capsules or tablets. */
internal data class DoseTotal(
    val frequency: String,
    val count: Int?,
    val capsule: Boolean,
    val sos: Boolean,
)

/** Dose cells, days and totals of one medicine line (as iOS `V9Dose`). */
internal object VisitDose {
    val slots = listOf(DoseSlot.Morning, DoseSlot.Afternoon, DoseSlot.Night)
    private val empty = RxDose(0, 0, 0)

    fun cell(halves: Int): String =
        when (halves) {
            0 -> "0"
            1 -> "½"
            2 -> "1"
            4 -> "2"
            else -> (halves / 2.0).toString()
        }

    fun halves(
        frequency: String,
        slot: DoseSlot,
    ): Int = (RxDose.parse(frequency) ?: empty).halves(slot)

    fun cycled(
        frequency: String,
        slot: DoseSlot,
    ): String = (RxDose.parse(frequency) ?: empty).cycle(slot).format()

    /** The form of a medicine from the line's detail (`500 mg tablet`): its last word. */
    fun formOf(detail: String): String? =
        detail
            .trim()
            .split(' ')
            .lastOrNull { it.isNotEmpty() }
            ?.lowercase()

    fun total(
        frequency: String,
        days: Int,
        detail: String,
        sos: Boolean = false,
    ): DoseTotal {
        val form = formOf(detail)
        val dose = RxDose.parse(frequency)
        val count = dose?.let { unitsTotal(it, days, form) }
        return DoseTotal(frequency, count, form.orEmpty().startsWith("cap"), sos)
    }

    /** The days a stepper tap leads to, inside the composer's range. */
    fun days(
        current: Int,
        step: Int,
    ): Int = (current + step).coerceIn(RX_MIN_DAYS, RX_MAX_DAYS)
}

/** What tapping Close visit does. */
internal enum class CloseDecision { Close, ConfirmUnsigned }

internal object CloseGuard {
    /** Closing asks first when there are medicines on the prescription and it has not been signed. */
    fun decide(
        medicines: Int,
        signed: Boolean,
    ): CloseDecision = if (medicines > 0 && !signed) CloseDecision.ConfirmUnsigned else CloseDecision.Close
}

/** The optional fee typed at close or Wrap up. */
internal object VisitMoney {
    private const val MAX_DIGITS = 9

    /** Rupees typed as `1,500` or `₹ 1500` in paise; null when empty. */
    fun paise(rupees: String): Long? {
        val digits = rupees.filter { it.isDigit() }
        if (digits.isEmpty() || digits.length > MAX_DIGITS) return null
        return digits.toLong() * PAISE
    }

    /** The fee as the field shows it: whole rupees, empty for none. */
    fun feeText(paise: Long?): String = if (paise == null || paise <= 0) "" else (paise / PAISE).toString()

    /** The fee typed back to paise; null for empty or zero. */
    fun feePaise(text: String): Long? = paise(text)?.takeIf { it > 0 }

    /** `₹1,500`, whole rupees in the Indian grouping. */
    fun rupees(paise: Long): String {
        val format = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("en-IN"))
        format.maximumFractionDigits = 0
        return format.format(paise / PAISE)
    }

    private const val PAISE = 100L
}

/** A treatment picked on the screen and held until the visit closes (as iOS `StagedProcedure`). */
internal data class StagedProcedure(
    val id: Int,
    val tooth: Int,
    val term: TermView,
    val surfaces: List<Surface> = emptyList(),
    val material: TermView? = null,
)

internal object VisitFormat {
    /** `7:05`, or `1:02:09` past an hour. Never negative. */
    fun timer(seconds: Long): String {
        val s = seconds.coerceAtLeast(0)
        val h = s / HOUR
        val m = s % HOUR / MINUTE
        val r = s % MINUTE
        return if (h > 0) "%d:%02d:%02d".format(h, m, r) else "%d:%02d".format(m, r)
    }

    /** The digits WhatsApp wants: 91 for a ten-digit number; null when it is not a phone number. */
    fun whatsAppDigits(raw: String?): String? {
        var digits = raw.orEmpty().filter { it.isDigit() }
        if (digits.length == ELEVEN && digits.startsWith("0")) digits = digits.drop(1)
        if (digits.length == TEN) digits = "91$digits"
        return digits.takeIf { it.length in ELEVEN..FIFTEEN }
    }

    /** `+91 98•••• 1234`; null when it is not a ten-digit number. */
    fun maskedPhone(raw: String?): String? {
        var digits = raw.orEmpty().filter { it.isDigit() }
        if (digits.length == TWELVE && digits.startsWith("91")) digits = digits.drop(2)
        if (digits.length == ELEVEN && digits.startsWith("0")) digits = digits.drop(1)
        if (digits.length != TEN) return null
        return "+91 ${digits.take(2)}•••• ${digits.takeLast(4)}"
    }

    private const val HOUR = 3600L
    private const val MINUTE = 60L
    private const val TEN = 10
    private const val ELEVEN = 11
    private const val TWELVE = 12
    private const val FIFTEEN = 15
}
