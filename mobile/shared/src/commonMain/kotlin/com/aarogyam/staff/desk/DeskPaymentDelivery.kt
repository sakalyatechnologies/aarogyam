package com.aarogyam.staff.desk

import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.model.Allocation
import com.aarogyam.staff.api.model.NewPayment
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.outbox.OutboxEntry
import com.aarogyam.staff.outbox.OutboxKind
import com.aarogyam.staff.outbox.OutboxSender
import com.aarogyam.staff.outbox.SendResult
import com.aarogyam.staff.outbox.toSendResult
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.time.Clock

/**
 * Registers the desk's payment sender on the app's one outbox ([AppGraph.outbox]). The entry id is
 * the payment's Idempotency-Key. The job names its clinic; after an app restart the clinic is not
 * open until the person opens it, so the entry waits (and is retried the moment a clinic opens).
 */
fun AppGraph.registerDeskPayments() {
    val log = Logger("aarogyam.deskoutbox")
    registerSender(OutboxKind.Payment, paymentSender(this, log))
}

private val jobJson = Json { ignoreUnknownKeys = true }

/** What an offline payment carries. Holds patient data: never logged. */
@Serializable
internal data class PaymentJob(
    val clinicSlug: String,
    val patientId: String,
    val method: String,
    val amountPaise: Long,
    val invoiceId: String? = null,
    val allocatedPaise: Long = 0,
    val proofId: String? = null,
    val proofJpegBase64: String? = null,
)

internal fun encodeJob(job: PaymentJob): String = jobJson.encodeToString(job)

@OptIn(ExperimentalEncodingApi::class)
internal fun encodeProof(jpeg: ByteArray): String = Base64.encode(jpeg)

internal sealed interface Delivery {
    data class Done(
        val number: String,
        val proof: ProofStatus,
    ) : Delivery

    data class Retry(
        val code: String,
    ) : Delivery

    data class Rejected(
        val error: ScreenError,
        val code: String,
    ) : Delivery
}

/**
 * Uploads the proof photo (kind `payment_proof`), if any, then sends the payment with [key] as the
 * Idempotency-Key and the proof's `attachment_id`. A proof the server refuses never blocks the
 * payment; a proof that merely failed to travel retries the whole entry.
 */
@OptIn(ExperimentalEncodingApi::class)
internal suspend fun deliver(
    api: ClinicApi,
    job: PaymentJob,
    key: String,
    log: Logger,
): Delivery {
    val idempotency = IdempotencyKey.parse(key) ?: return Delivery.Rejected(ScreenError.Unknown, "bad_key")
    val method =
        PayMethod.entries.firstOrNull { it.name == job.method }
            ?: return Delivery.Rejected(ScreenError.Unknown, "bad_method")
    // The proof goes first so the payment can name it. Its id is the client's, so a retry is safe.
    var attachmentId: String? = null
    var proof = ProofStatus.None
    val photo = job.proofJpegBase64
    if (photo != null) {
        val proofId = job.proofId
        proof = ProofStatus.NotSent
        if (proofId != null) {
            when (val up = api.uploadAttachment(job.patientId, proofId, PROOF_KIND, Base64.decode(photo), null, null)) {
                is Outcome.Success -> {
                    attachmentId = up.value.id
                    proof = ProofStatus.Sent
                }

                is Outcome.Failure -> {
                    log.warn("deskpay.proof_failed") { code("error", up.error.code.value) }
                    // Nothing is recorded yet: a proof that only failed to travel retries the whole entry.
                    if (up.toSendResult() is SendResult.Retry) return Delivery.Retry(up.error.code.value)
                }
            }
        }
    }
    val payment =
        NewPayment(
            patientId = job.patientId,
            method = method.wire,
            amountPaise = job.amountPaise,
            allocations =
                job.invoiceId?.let { listOf(Allocation(invoiceId = it, amountPaise = job.allocatedPaise)) }
                    ?: emptyList(),
            attachmentId = attachmentId,
        )
    val paid = api.recordPayment(payment, idempotency)
    if (paid is Outcome.Failure) {
        log.warn("deskpay.send_failed") { code("error", paid.error.code.value) }
        return when (val send = paid.toSendResult()) {
            is SendResult.Retry -> Delivery.Retry(send.code)
            is SendResult.Rejected -> Delivery.Rejected(ScreenError.of(paid.error), send.code)
            SendResult.Delivered -> Delivery.Retry("unexpected")
        }
    }
    return Delivery.Done((paid as Outcome.Success).value.number, proof)
}

/** The upload kind the front desk may attach to a payment (`billing.write`). */
internal const val PROOF_KIND = "payment_proof"

private fun paymentSender(
    graph: AppGraph,
    log: Logger,
) = OutboxSender { entry: OutboxEntry ->
    if (entry.kind != OutboxKind.Payment) return@OutboxSender SendResult.Rejected("unsupported_kind")
    val job =
        runCatching { jobJson.decodeFromString<PaymentJob>(entry.payload) }.getOrNull()
            ?: return@OutboxSender SendResult.Rejected("bad_payload")
    val clinic = graph.directory.opened(job.clinicSlug) ?: return@OutboxSender SendResult.Retry("clinic_not_open")
    when (val delivery = deliver(clinic.api, job, entry.id, log)) {
        is Delivery.Done -> SendResult.Delivered
        is Delivery.Retry -> SendResult.Retry(delivery.code)
        is Delivery.Rejected -> SendResult.Rejected(delivery.code)
    }
}
