package com.aarogyam.staff.desk

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.MessagesQueued
import com.aarogyam.staff.api.model.SendMessages
import com.aarogyam.staff.api.sendMessages
import com.aarogyam.staff.billing.rupeesText
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** A recorded payment as its receipt shows it: Print, WhatsApp and Email all start from this. */
data class Receipt(
    val paymentId: String,
    val patientId: String,
    val number: String,
    val amountPaise: Long,
    /** The wire method (`cash`, `upi`...). */
    val method: String,
    /** The day it was received in the clinic's time zone (`YYYY-MM-DD`). */
    val receivedOn: String,
    /** The bill it paid, when one bill was paid and it has a number. */
    val invoiceNumber: String?,
    val clinicName: String,
) {
    /** The rupee amount as the receipt prints it. */
    val amountText: String get() = "₹${rupeesText(amountPaise)}"

    /** One line, with no patient name: the WhatsApp text and the email body. */
    fun shareText(): String {
        val bill = invoiceNumber?.let { " for bill $it" }.orEmpty()
        return "Receipt $number from $clinicName: $amountText received$bill."
    }

    fun emailSubject(): String = "Your receipt $number"

    /** The body of `POST /api/v1/messages` that emails the receipt; [batchId] is new for each tap. */
    fun emailRequest(batchId: String): SendMessages =
        SendMessages(
            patientIds = listOf(patientId),
            channel = "email",
            templateKey = "care.note",
            batchId = batchId,
            body = shareText(),
            variables = mapOf("subject" to emailSubject()),
        )
}

/** Where emailing a receipt stands. */
sealed interface ReceiptEmail {
    data object Idle : ReceiptEmail

    data object Sending : ReceiptEmail

    data object Queued : ReceiptEmail

    data object NoEmail : ReceiptEmail

    data object NoConsent : ReceiptEmail

    data object AlreadySent : ReceiptEmail

    data class Failed(
        val error: ScreenError,
    ) : ReceiptEmail
}

/** What the server's answer means for the person at the desk. */
internal fun MessagesQueued.toReceiptEmail(): ReceiptEmail =
    when {
        queued > 0 -> ReceiptEmail.Queued
        (noConsent ?: 0L) > 0 -> ReceiptEmail.NoConsent
        (noAddress ?: 0L) > 0 -> ReceiptEmail.NoEmail
        else -> ReceiptEmail.AlreadySent
    }

/** Emails a receipt through the message queue. Shown only with `messages.send`. */
class ReceiptEmailHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val newBatch: () -> String = { IdempotencyKey.generate().toString() },
    private val log: Logger = Logger("aarogyam.receipt"),
) {
    val canEmail: Boolean = MESSAGES_SEND in clinic.permissions
    private val mutableState = MutableStateFlow<ReceiptEmail>(ReceiptEmail.Idle)
    val state: StateFlow<ReceiptEmail> = mutableState.asStateFlow()

    fun send(receipt: Receipt) {
        if (!canEmail || mutableState.value == ReceiptEmail.Sending) return
        mutableState.value = ReceiptEmail.Sending
        scope.launch {
            mutableState.value =
                when (val sent = clinic.api.sendMessages(receipt.emailRequest(newBatch()))) {
                    is Outcome.Success -> {
                        sent.value.toReceiptEmail()
                    }

                    is Outcome.Failure -> {
                        log.warn("receipt.email_failed") { code("error", sent.error.code.value) }
                        ReceiptEmail.Failed(ScreenError.of(sent.error))
                    }
                }
        }
    }

    private companion object {
        const val MESSAGES_SEND = "messages.send"
    }
}
