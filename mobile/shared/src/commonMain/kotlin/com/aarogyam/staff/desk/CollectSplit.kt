package com.aarogyam.staff.desk

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.collectSummary
import com.aarogyam.staff.api.invoice
import com.aarogyam.staff.outbox.SendResult
import com.aarogyam.staff.outbox.toSendResult
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.serialization.Serializable

/** The part of one payment that goes to one bill. */
@Serializable
data class BillShare(
    val invoiceId: String,
    val number: String? = null,
    val amountPaise: Long,
)

/**
 * Splits [amountPaise] over [bills], oldest first: each bill is settled in full before the next, and
 * no bill gets more than its balance; whatever is left stays with the patient as an advance.
 */
fun allocateOldestFirst(
    bills: List<DueBill>,
    amountPaise: Long,
): List<BillShare> {
    var left = amountPaise
    return bills.mapNotNull { bill ->
        val share = minOf(left, bill.balancePaise)
        if (share <= 0) return@mapNotNull null
        left -= share
        BillShare(bill.id, bill.number, share)
    }
}

/**
 * Reads each bill of a split again just before sending. All settled meanwhile is
 * [Recheck.AlreadyPaid]; any bill now owing less than its share is [Recheck.Changed] with what the
 * bills still owe, so the screen shows a new split rather than sending one the server would refuse.
 */
internal suspend fun recheckShares(
    api: ClinicApi,
    job: PaymentJob,
    log: Logger,
    canCollect: Boolean,
): Recheck {
    var owed = 0L
    var short = false
    for (share in job.shares) {
        val balance =
            if (canCollect) {
                when (val fresh = api.collectSummary(share.invoiceId)) {
                    is Outcome.Success -> fresh.value.balancePaise
                    is Outcome.Failure -> return failed(fresh.error, log)
                }
            } else {
                when (val fresh = api.invoice(share.invoiceId)) {
                    is Outcome.Success -> fresh.value.balancePaise
                    is Outcome.Failure -> return failed(fresh.error, log)
                }
            }
        owed += balance.coerceAtLeast(0)
        if (balance < share.amountPaise) short = true
    }
    return when {
        owed <= 0 -> Recheck.AlreadyPaid
        short -> Recheck.Changed(owed)
        else -> Recheck.Proceed(job)
    }
}

private fun failed(
    error: com.sakalya.mobile.core.ApiError,
    log: Logger,
): Recheck {
    log.warn("deskpay.recheck_failed") { code("error", error.code.value) }
    return when (val send = Outcome.Failure(error).toSendResult()) {
        is SendResult.Retry -> Recheck.Retry(send.code)
        else -> Recheck.Rejected(ScreenError.of(error))
    }
}
