package com.aarogyam.staff.billing

import com.aarogyam.staff.api.model.Invoice
import com.aarogyam.staff.today.parseInstant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

/** A bill's state as the clinic reads it; values the app doesn't know yet are [Unknown]. */
enum class BillStatus { Issued, PartPaid, Paid, Void, Unknown }

/** How a payment is taken on the phone (the API also knows `bank`, which the portal records). */
enum class PayMethod(
    internal val wire: String,
) {
    Cash("cash"),
    Upi("upi"),
    Card("card"),
}

/** One bill in the patient's list. Amounts are paise; the screens format them as rupees. */
data class BillView(
    val id: String,
    val number: String?,
    val issuedOn: LocalDate?,
    val totalPaise: Long,
    val paidPaise: Long,
    val balancePaise: Long,
    val status: BillStatus,
    /** Issued with something left to pay, for a role that holds `billing.write`. */
    val canRecordPayment: Boolean,
)

/** The Billing tab: what the patient owes across issued bills, and every bill except drafts. */
data class BillingView(
    val balancePaise: Long,
    val bills: List<BillView>,
)

internal fun Invoice.toBill(
    zone: TimeZone,
    canWrite: Boolean,
): BillView? {
    if (status == "draft") return null
    val state =
        when (status) {
            "void" -> {
                BillStatus.Void
            }

            "issued" -> {
                when (paymentState) {
                    "paid" -> BillStatus.Paid
                    "partial" -> BillStatus.PartPaid
                    else -> BillStatus.Issued
                }
            }

            else -> {
                BillStatus.Unknown
            }
        }
    val owing = status == "issued" && balancePaise > 0
    return BillView(
        id = id,
        number = number,
        issuedOn = issuedAt?.let(::parseInstant)?.toLocalDateTime(zone)?.date,
        totalPaise = totalPaise,
        paidPaise = paidPaise,
        balancePaise = if (status == "issued") balancePaise else 0,
        status = state,
        canRecordPayment = owing && canWrite,
    )
}

internal fun List<BillView>.toView() = BillingView(balancePaise = sumOf { it.balancePaise }, bills = this)

/** `1250` for 125000 paise, `1250.5` for 125050: the amount field's starting text. */
internal fun rupeesText(paise: Long): String {
    val whole = paise / PAISE
    val cents = paise % PAISE
    return when {
        cents == 0L -> whole.toString()
        cents % TEN == 0L -> "$whole.${cents / TEN}"
        else -> "$whole.${cents.toString().padStart(2, '0')}"
    }
}

private val RUPEES = Regex("""\d{1,9}(\.\d{1,2})?""")

/** Rupees typed as `1250` or `1250.50`, in paise; null for anything else, zero included. */
internal fun parseRupees(text: String): Long? {
    val trimmed = text.trim()
    if (!RUPEES.matches(trimmed)) return null
    val whole = trimmed.substringBefore('.').toLong()
    val cents = trimmed.substringAfter('.', "").padEnd(2, '0').toLong()
    return (whole * PAISE + cents).takeIf { it > 0 }
}

private const val PAISE = 100L
private const val TEN = 10L
