package com.aarogyam.staff.android.ui.patient

import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.chart.Finding
import com.aarogyam.staff.history.BillState
import com.aarogyam.staff.history.VisitKind
import com.aarogyam.staff.history.VisitTitleSource
import com.aarogyam.staff.patients.MoneySummary
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.plus
import java.time.format.TextStyle
import java.util.Locale

/** The three pill tabs of the patient page. */
enum class PatientPageTab {
    Overview,
    History,
    Consent,
    ;

    companion object {
        /** The tabs a role sees: Overview needs `clinical.read`; History and Consent need `patients.read`. */
        fun visible(permissions: Set<String>): List<PatientPageTab> =
            entries.filter { tab ->
                when (tab) {
                    Overview -> "clinical.read" in permissions
                    History, Consent -> "patients.read" in permissions
                }
            }
    }
}

/** What the header's money strip shows: nothing without money, a closed bar, or the three cells. */
sealed interface MoneyStripModel {
    data object None : MoneyStripModel

    data object Closed : MoneyStripModel

    data class Open(
        val visits: String,
        val paid: String,
        val due: String,
        val hasDue: Boolean,
    ) : MoneyStripModel

    companion object {
        /** [money] is null for a role without `billing.read`; [shown] starts false. */
        fun make(
            money: MoneySummary?,
            shown: Boolean,
        ): MoneyStripModel =
            when {
                money == null -> {
                    None
                }

                !shown -> {
                    Closed
                }

                else -> {
                    Open(
                        money.visits.toString(),
                        money.paidPaise.rupees(),
                        money.remainingPaise.rupees(),
                        money.remainingPaise > 0,
                    )
                }
            }
    }
}

/** One History card's chips, from what the list knows. */
sealed interface HistoryChip {
    data object Notes : HistoryChip

    data object Rx : HistoryChip

    data object Photos : HistoryChip

    data object Paid : HistoryChip

    data object Due : HistoryChip

    data object Open : HistoryChip

    data class Tooth(
        val number: Int,
    ) : HistoryChip

    data class DueAmount(
        val text: String,
    ) : HistoryChip
}

/** The date badge: day and month, or "Today" ([isToday]) for the clinic's today. */
data class DateBadge(
    val top: String,
    val bottom: String?,
    val isToday: Boolean,
)

/** What a History card or visit detail is titled with. */
sealed interface HistoryTitle {
    data class Text(
        val value: String,
    ) : HistoryTitle

    data object Appointment : HistoryTitle

    data object WalkIn : HistoryTitle

    data object Visit : HistoryTitle
}

object HistoryRowFormat {
    fun badge(
        date: LocalDate,
        today: LocalDate,
        locale: Locale = Locale.getDefault(),
    ): DateBadge =
        if (date == today) {
            DateBadge("", null, true)
        } else {
            DateBadge(
                date.day.toString(),
                java.time.Month
                    .of(date.month.ordinal + 1)
                    .getDisplayName(TextStyle.SHORT, locale),
                false,
            )
        }

    /** Notes and photos only when the list says so; the bill chip only for a role that sees money. */
    fun chips(
        hasNotes: Boolean?,
        hasRx: Boolean,
        hasPhotos: Boolean?,
        bill: BillState,
        open: Boolean,
        teeth: List<Int> = emptyList(),
        duePaise: Long? = null,
    ): List<HistoryChip> =
        buildList {
            if (open) add(HistoryChip.Open)
            teeth.forEach { add(HistoryChip.Tooth(it)) }
            if (hasNotes == true) add(HistoryChip.Notes)
            if (hasRx) add(HistoryChip.Rx)
            if (hasPhotos == true) add(HistoryChip.Photos)
            when (bill) {
                BillState.Paid -> add(HistoryChip.Paid)
                BillState.Due -> add(dueText(duePaise, true)?.let { HistoryChip.DueAmount(it) } ?: HistoryChip.Due)
                BillState.None -> Unit
            }
        }

    /** `₹6,000`-style balance of a bill, or null when the role has no money or nothing is left. */
    fun dueText(
        duePaise: Long?,
        moneyVisible: Boolean,
    ): String? = if (moneyVisible && duePaise != null && duePaise > 0) duePaise.rupees() else null

    /** The complaint, else the first procedure's name, else how the visit began, else "Visit". */
    fun title(
        complaint: String?,
        procedure: String?,
        kind: VisitKind?,
    ): HistoryTitle {
        val text = listOf(complaint, procedure).firstNotNullOfOrNull { it?.trim()?.takeIf(String::isNotEmpty) }
        return when {
            text != null -> HistoryTitle.Text(text)
            kind == VisitKind.Appointment -> HistoryTitle.Appointment
            kind == VisitKind.WalkIn -> HistoryTitle.WalkIn
            else -> HistoryTitle.Visit
        }
    }

    fun title(source: VisitTitleSource): HistoryTitle = title(source.complaint, source.firstProcedure, source.kind)
}

/** The Patients list filter chips. Only Recalls can be answered from what the list returns. */
enum class PatientFilter {
    All,
    Dues,
    Recalls,
    New,
    ;

    /** "With dues" and "New" need the list to carry the balance and the registration date (BK-21). */
    val needsServer: Boolean get() = this == Dues || this == New
}

/** Links that leave the app: the dialler and WhatsApp. They carry a number, never a name. */
object PatientLinks {
    /** The number as `tel:` wants it: digits, with a leading `+` kept. */
    fun tel(phone: String?): String? {
        val digits = digits(phone ?: return null)
        if (digits.isEmpty()) return null
        return "tel:" + (if (phone.trim().startsWith("+")) "+" else "") + digits
    }

    /** `https://wa.me/<number>`; a ten-digit Indian number gets its country code. */
    fun whatsApp(phone: String?): String? {
        var number = digits(phone ?: return null)
        if (number.length == INDIAN_LOCAL) number = "91$number"
        return if (number.length >= MIN_INTERNATIONAL) "https://wa.me/$number" else null
    }

    private fun digits(phone: String): String = phone.filter { it in '0'..'9' }

    private const val INDIAN_LOCAL = 10
    private const val MIN_INTERNATIONAL = 11
}

/** The days the booking sheet offers, from today. */
object BookingDays {
    fun next(
        count: Int,
        from: LocalDate,
    ): List<LocalDate> = (0 until count).map { from.plus(DatePeriod(days = it)) }
}

/** How a tooth shows on the jaw. */
enum class JawTone {
    Plain,
    Treated,
    Progress,
    Watch,
    Care,
    Missing,
    ;

    companion object {
        fun of(finding: Finding): JawTone =
            when (finding) {
                Finding.Sound -> Plain
                Finding.Filled, Finding.Crown, Finding.Implant, Finding.Bridge -> Treated
                Finding.RootCanal -> Progress
                Finding.Watch -> Watch
                Finding.Caries, Finding.Fractured -> Care
                Finding.Missing -> Missing
            }
    }
}

/** Why a quadrant: the FDI tooth's quarter of the mouth, 1 and 5 upper right and so on. */
enum class Quadrant {
    UpperRight,
    UpperLeft,
    LowerLeft,
    LowerRight,
    ;

    companion object {
        fun of(tooth: Int): Quadrant =
            when (tooth / TENS) {
                1, 5 -> UpperRight
                2, 6 -> UpperLeft
                3, 7 -> LowerLeft
                else -> LowerRight
            }

        private const val TENS = 10
    }
}
