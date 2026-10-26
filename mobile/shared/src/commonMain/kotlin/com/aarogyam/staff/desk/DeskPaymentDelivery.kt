package com.aarogyam.staff.desk

import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.collectSummary
import com.aarogyam.staff.api.issueInvoice
import com.aarogyam.staff.api.model.Allocation
import com.aarogyam.staff.api.model.CollectUpi
import com.aarogyam.staff.api.model.NewPayment
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.outbox.OutboxEntry
import com.aarogyam.staff.outbox.OutboxKind
import com.aarogyam.staff.outbox.OutboxSender
import com.aarogyam.staff.outbox.SendResult
import com.aarogyam.staff.outbox.toSendResult
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.url
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
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
    /** The bill is a draft: issue it first (`POST /invoices/{id}/issue`), then pay, in this order. */
    val issueFirst: Boolean = false,
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

    /** [conflict] is a 409 from `POST /payments`: refetch the bill and show what the server has. */
    data class Rejected(
        val error: ScreenError,
        val code: String,
        val conflict: Boolean = false,
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
    // A draft is issued before it can take a payment. Already issued (409) is fine: a retry or the
    // server issued it. The payment is then allocated to what the issued bill really owes.
    var allocated = job.allocatedPaise
    if (job.issueFirst && job.invoiceId != null) {
        when (val issued = api.issueInvoice(job.invoiceId)) {
            is Outcome.Success -> {
                allocated = minOf(job.amountPaise, issued.value.balancePaise)
            }

            is Outcome.Failure -> {
                if (issued.error.kind != ApiErrorKind.Conflict) {
                    log.warn("deskpay.issue_failed") { code("error", issued.error.code.value) }
                    return when (val send = issued.toSendResult()) {
                        is SendResult.Retry -> Delivery.Retry(send.code)
                        is SendResult.Rejected -> Delivery.Rejected(ScreenError.of(issued.error), send.code)
                        SendResult.Delivered -> Delivery.Retry("unexpected")
                    }
                }
            }
        }
    }
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
                job.invoiceId?.let { listOf(Allocation(invoiceId = it, amountPaise = allocated)) }
                    ?: emptyList(),
        )
    val paid = api.recordPayment(payment, idempotency, attachmentId)
    if (paid is Outcome.Failure) {
        log.warn("deskpay.send_failed") { code("error", paid.error.code.value) }
        return when (val send = paid.toSendResult()) {
            is SendResult.Retry -> {
                Delivery.Retry(send.code)
            }

            is SendResult.Rejected -> {
                Delivery.Rejected(ScreenError.of(paid.error), send.code, paid.error.kind == ApiErrorKind.Conflict)
            }

            SendResult.Delivered -> {
                Delivery.Retry("unexpected")
            }
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

/** What the collect race check decided before a payment goes out (R8). */
internal sealed interface Recheck {
    /** Send [job]: its allocation and issue-first now follow the bill as the server has it. */
    data class Proceed(
        val job: PaymentJob,
        val upi: CollectUpi? = null,
    ) : Recheck

    /** The balance is 0: show "Already paid" and send nothing. */
    data object AlreadyPaid : Recheck

    /** The bill could not be read for a reason that is worth retrying: save the payment. */
    data class Retry(
        val code: String,
    ) : Recheck

    data class Rejected(
        val error: ScreenError,
    ) : Recheck
}

/**
 * Before `POST /payments`: re-GET `/invoices/{id}/collect-summary` (`payments.collect`) and use its
 * current balance. An issued bill with a balance of 0 is [Recheck.AlreadyPaid]; a draft is allocated
 * by its total and the server issues it when the payment is recorded; any other bill is refused. A job with no invoice is sent as it is.
 */
internal suspend fun recheck(
    api: ClinicApi,
    job: PaymentJob,
    log: Logger,
): Recheck {
    val invoiceId = job.invoiceId ?: return Recheck.Proceed(job)
    return when (val fresh = api.collectSummary(invoiceId)) {
        is Outcome.Failure -> {
            log.warn("deskpay.recheck_failed") { code("error", fresh.error.code.value) }
            when (val send = fresh.toSendResult()) {
                is SendResult.Retry -> Recheck.Retry(send.code)
                else -> Recheck.Rejected(ScreenError.of(fresh.error))
            }
        }

        is Outcome.Success -> {
            val bill = fresh.value
            when (bill.status) {
                "draft" -> {
                    Recheck.Proceed(
                        job.copy(
                            patientId = bill.patient.id,
                            issueFirst = false,
                            allocatedPaise = minOf(job.amountPaise, bill.totalPaise),
                        ),
                        bill.upi,
                    )
                }

                "issued" -> {
                    if (bill.balancePaise <= 0) {
                        Recheck.AlreadyPaid
                    } else {
                        Recheck.Proceed(
                            job.copy(
                                patientId = bill.patient.id,
                                issueFirst = false,
                                allocatedPaise = minOf(job.amountPaise, bill.balancePaise),
                            ),
                            bill.upi,
                        )
                    }
                }

                else -> {
                    Recheck.Rejected(ScreenError.Unknown)
                }
            }
        }
    }
}

/**
 * `GET /notifications`, read by hand: [ids] of the `collect_payment` rows and which of them are
 * `handled`. The `handled` and `audience` fields are not in main's contract, so any row that has
 * either key turns `ServerCaps.notificationAudience` on (G-flag), and `handledIds` stays empty while
 * it is off.
 */
internal data class CollectNotices(
    val handledIds: Set<String>,
    val seenIds: Set<String>,
)

internal suspend fun ClinicApi.collectNotices(): Outcome<CollectNotices, ApiError> =
    when (val answer = client.call<JsonObject> { url("api/v1/notifications") }) {
        is Outcome.Failure -> {
            answer
        }

        is Outcome.Success -> {
            val rows =
                (answer.value["items"] as? JsonArray)
                    ?.mapNotNull { it as? JsonObject }
                    .orEmpty()
            if (rows.any { "handled" in it || "audience" in it }) ServerCaps.markNotificationAudience()
            val collect = rows.filter { it["kind"]?.jsonPrimitive?.contentOrNull == "collect_payment" }
            Outcome.Success(
                CollectNotices(
                    handledIds =
                        if (ServerCaps.notificationAudience) {
                            collect
                                .filter { it["handled"].let { h -> h != null && h !is JsonNull } }
                                .mapNotNull { it["id"]?.jsonPrimitive?.contentOrNull }
                                .toSet()
                        } else {
                            emptySet()
                        },
                    seenIds = collect.mapNotNull { it["id"]?.jsonPrimitive?.contentOrNull }.toSet(),
                ),
            )
        }
    }
