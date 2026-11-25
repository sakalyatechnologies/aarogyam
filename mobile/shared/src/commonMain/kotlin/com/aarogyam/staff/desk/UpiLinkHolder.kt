package com.aarogyam.staff.desk

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.invoiceUpiLink
import com.aarogyam.staff.billing.rupeesText
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** A UPI payment link ready to share (BK-13). */
data class UpiShare(
    /** The `upi://pay` link. */
    val uri: String,
    /** The text to encode in a QR code. */
    val qrData: String,
    /** The text for the share sheet: what to pay, to whom, and the link. */
    val text: String,
)

sealed interface UpiLinkState {
    data object Idle : UpiLinkState

    data object Loading : UpiLinkState

    data class Ready(
        val share: UpiShare,
    ) : UpiLinkState

    data class Failed(
        val error: ScreenError,
    ) : UpiLinkState
}

/**
 * "Send UPI link" on a bill: `GET /invoices/{id}/upi-link` for what is left to pay. It records
 * nothing; the payment is recorded as usual when it arrives. Needs `billing.write`.
 */
class UpiLinkHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.upilink"),
) {
    private val mutableState = MutableStateFlow<UpiLinkState>(UpiLinkState.Idle)
    val state: StateFlow<UpiLinkState> = mutableState.asStateFlow()

    private val allowed = BILLING_WRITE in clinic.permissions

    /** The button shows for an issued bill with a balance, to a member who may write billing. */
    fun canSend(due: DueBill): Boolean = allowed && !due.draft && due.balancePaise > 0

    /** Fetches the link for [invoiceId]. */
    fun send(invoiceId: String) {
        if (!allowed || mutableState.value == UpiLinkState.Loading) return
        mutableState.value = UpiLinkState.Loading
        scope.launch {
            mutableState.value =
                when (val answer = clinic.api.invoiceUpiLink(invoiceId)) {
                    is Outcome.Success -> {
                        val link = answer.value
                        UpiLinkState.Ready(
                            UpiShare(
                                link.uri,
                                link.qrData,
                                "Pay Rs ${rupeesText(link.amountPaise)} to ${link.payeeName} " +
                                    "for bill ${link.invoiceNumber}: ${link.uri}",
                            ),
                        )
                    }

                    is Outcome.Failure -> {
                        log.warn("upilink.failed")
                        UpiLinkState.Failed(ScreenError.of(answer.error))
                    }
                }
        }
    }

    /** Back to the button, after the link was shown or the failure read. */
    fun dismiss() {
        mutableState.value = UpiLinkState.Idle
    }

    private companion object {
        const val BILLING_WRITE = "billing.write"
    }
}
