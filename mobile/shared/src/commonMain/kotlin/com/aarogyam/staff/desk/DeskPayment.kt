package com.aarogyam.staff.desk

import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.invoice
import com.aarogyam.staff.api.model.CollectUpi
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.outbox.OutboxKind
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlin.time.Clock
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * One bill with something to pay. Amounts are paise. A [draft] is issued first (its [balancePaise]
 * is the draft's total, a preview: the issued total may differ by tax and round-off).
 */
data class DueBill(
    val id: String,
    val number: String?,
    val balancePaise: Long,
    val draft: Boolean = false,
    /** The UPI link for this bill, set once the collect-summary was read (QR and open-app link). */
    val upi: CollectUpi? = null,
)

/** What the collect-payment sheet draws before a payment is sent. */
sealed interface DeskPayState {
    data object Loading : DeskPayState

    /** The role lacks `billing.read` or `billing.write`; nothing was requested. */
    data object NotAllowed : DeskPayState

    data class Failed(
        val error: ScreenError,
    ) : DeskPayState

    /** [canAttachProof] needs `billing.write` (the `payment_proof` upload). */
    data class Ready(
        val dues: List<DueBill>,
        val canAttachProof: Boolean,
    ) : DeskPayState
}

enum class ProofStatus { None, Sent, NotSent }

/** What sending the payment did. */
sealed interface DeskPayOutcome {
    data object Idle : DeskPayOutcome

    data object Sending : DeskPayOutcome

    /** The bill's balance is 0 now (someone else collected it): "Already paid", nothing was sent. */
    data object AlreadyPaid : DeskPayOutcome

    /** The server has it; [number] is the receipt. */
    data class Recorded(
        val number: String,
        val proof: ProofStatus,
    ) : DeskPayOutcome

    /** Offline or the network dropped: saved on the phone, "Saved, will send". */
    data object Saved : DeskPayOutcome

    data class Failed(
        val error: ScreenError,
    ) : DeskPayOutcome
}

/**
 * Collect payment for one patient: their issued bills with a balance, then `POST /payments` with an
 * Idempotency-Key kept across retries of one submission. When the phone is offline, or the network
 * drops mid-send, the payment goes to the app outbox ([AppGraph.outbox], kept on the phone) with the same key and the
 * sheet shows "Saved, will send". An optional proof photo is uploaded as a `payment_proof` file and
 * named by `attachment_id` on the payment.
 */
class DeskPaymentStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val graph: AppGraph,
    private val log: Logger = Logger("aarogyam.deskpay"),
    private val clock: () -> Instant = { Clock.System.now() },
) {
    private val allowed = BILLING_READ in clinic.permissions && BILLING_WRITE in clinic.permissions
    private val canProof get() = BILLING_WRITE in clinic.permissions && ServerCaps.paymentProof
    private val runner = graph.outbox
    private val mutableState =
        MutableStateFlow<DeskPayState>(if (allowed) DeskPayState.Loading else DeskPayState.NotAllowed)
    private val mutableOutcome = MutableStateFlow<DeskPayOutcome>(DeskPayOutcome.Idle)

    // One key per submission: kept while the same payment is retried, replaced when it changes.
    private var keyed: Pair<String, String>? = null

    private val mutableCardOpen = MutableStateFlow(true)

    /**
     * The To-pay card is open until its `collect_payment` notification is `handled` (see [checkHandled];
     * needs `ServerCaps.notificationAudience`) or no bill has a balance.
     */
    val cardOpen: StateFlow<Boolean> = mutableCardOpen.asStateFlow()

    val state: StateFlow<DeskPayState> = mutableState.asStateFlow()
    val outcome: StateFlow<DeskPayOutcome> = mutableOutcome.asStateFlow()

    /** Payments saved on this phone and not yet sent, for the "Saved, will send" badge. */
    val pending: StateFlow<Int> get() = runner.pending

    init {
        if (allowed) load()
    }

    fun refresh() {
        if (!allowed) return
        mutableState.value = DeskPayState.Loading
        load()
    }

    private val upis = mutableMapOf<String, CollectUpi>()

    private fun showUpi(
        invoiceId: String?,
        upi: CollectUpi?,
    ) {
        if (invoiceId != null && upi != null) upis[invoiceId] = upi
        val ready = mutableState.value as? DeskPayState.Ready ?: return
        mutableState.value =
            ready.copy(dues = ready.dues.map { if (it.id == invoiceId) it.copy(upi = upi) else it })
    }

    private fun load() {
        scope.launch {
            when (val result = clinic.api.invoices(patientId)) {
                is Outcome.Success -> {
                    // The list has no lines, so a draft reads a total of 0 there: ask for the bill itself.
                    val dues =
                        result.value.items.mapNotNull { row ->
                            if (row.status == "draft") {
                                (clinic.api.invoice(row.id) as? Outcome.Success)?.value?.let {
                                    dueBillOf(it.id, it.number ?: row.number, it.status, it.totalPaise, it.balancePaise)
                                }
                            } else {
                                dueBillOf(row.id, row.number, row.status, row.totalPaise, row.balancePaise)
                            }
                        }
                    mutableState.value = DeskPayState.Ready(dues.map { it.copy(upi = upis[it.id]) }, canProof)
                    if (dues.isEmpty()) mutableCardOpen.value = false
                }

                is Outcome.Failure -> {
                    log.warn("deskpay.load_failed") { code("error", result.error.code.value) }
                    mutableState.value = DeskPayState.Failed(ScreenError.of(result.error))
                }
            }
        }
    }

    /** Clears a shown outcome (a failure the person has read). */
    fun dismissOutcome() {
        if (mutableOutcome.value is DeskPayOutcome.Failed) mutableOutcome.value = DeskPayOutcome.Idle
    }

    /**
     * Records [amountPaise] by [method], allocated to [invoiceId] when given. [proofJpeg] is a photo
     * already resized on the phone. A second tap while sending does nothing.
     */
    fun record(
        invoiceId: String?,
        amountPaise: Long,
        method: PayMethod,
        proofJpeg: ByteArray?,
    ) {
        if (!allowed || amountPaise <= 0 || mutableOutcome.value == DeskPayOutcome.Sending) return
        val proof = proofJpeg?.takeIf { canProof && it.isNotEmpty() }
        val job =
            PaymentJob(
                clinicSlug = clinic.slug,
                patientId = patientId,
                method = method.name,
                amountPaise = amountPaise,
                invoiceId = invoiceId,
                allocatedPaise = invoiceId?.let { id -> minOf(amountPaise, dueOf(id)) } ?: 0,
                issueFirst = invoiceId?.let { id -> draftOf(id) } ?: false,
                proofId = proof?.let { IdempotencyKey.generate().toString() },
                proofJpegBase64 = proof?.let(::encodeProof),
            )
        val fingerprint = "$invoiceId|$amountPaise|${method.name}|${proof?.size}"
        val key =
            keyed?.takeIf { it.first == fingerprint }?.second
                ?: IdempotencyKey.generate().toString().also { keyed = fingerprint to it }
        mutableOutcome.value = DeskPayOutcome.Sending
        scope.launch {
            if (!graph.connectivity.online.value) {
                save(job, key)
                return@launch
            }
            // R8: the balance is read again just before sending; the screen's list may be stale.
            val fresh =
                when (val check = recheck(clinic.api, job, log)) {
                    is Recheck.Proceed -> {
                        showUpi(invoiceId, check.upi)
                        check.job
                    }

                    Recheck.AlreadyPaid -> {
                        keyed = null
                        mutableOutcome.value = DeskPayOutcome.AlreadyPaid
                        load()
                        return@launch
                    }

                    is Recheck.Retry -> {
                        save(job, key)
                        return@launch
                    }

                    is Recheck.Rejected -> {
                        mutableOutcome.value = DeskPayOutcome.Failed(check.error)
                        load()
                        return@launch
                    }
                }
            when (val delivery = deliver(clinic.api, fresh, key, log)) {
                is Delivery.Done -> {
                    keyed = null
                    mutableOutcome.value = DeskPayOutcome.Recorded(delivery.number, delivery.proof)
                    load()
                }

                is Delivery.Retry -> {
                    save(job, key)
                }

                is Delivery.Rejected -> {
                    // A 409 means the bill changed under us: show the server's state, not ours.
                    if (delivery.conflict && invoiceId != null) {
                        val now = (clinic.api.invoice(invoiceId) as? Outcome.Success)?.value
                        keyed = null
                        mutableOutcome.value =
                            if (now != null && now.status == "issued" && now.balancePaise <= 0) {
                                DeskPayOutcome.AlreadyPaid
                            } else {
                                DeskPayOutcome.Failed(delivery.error)
                            }
                        load()
                    } else {
                        mutableOutcome.value = DeskPayOutcome.Failed(delivery.error)
                    }
                }
            }
        }
    }

    /**
     * Reads the notifications and closes the To-pay card when [notificationId] (its `collect_payment`
     * row) is `handled`. Needs `ServerCaps.notificationAudience`; while it is off this never closes the card.
     */
    fun checkHandled(notificationId: String) {
        scope.launch {
            val notices = (clinic.api.collectNotices() as? Outcome.Success)?.value ?: return@launch
            if (notificationId in notices.handledIds) mutableCardOpen.value = false
        }
    }

    /**
     * "Doctor may be collecting": the token is `ready_to_bill` and its visit ended (`ended_at`) under
     * 2 minutes ago. Display only; the payment is not blocked.
     */
    fun doctorMayBeCollecting(
        tokenStatus: String,
        visitEndedAt: String?,
    ): Boolean = doctorMayBeCollecting(tokenStatus, visitEndedAt?.let(::parseInstant), clock())

    private fun save(
        job: PaymentJob,
        key: String,
    ) {
        runner.enqueue(OutboxKind.Payment, encodeJob(job), key)
        keyed = null
        log.info("deskpay.saved_offline") { id("entry", key) }
        mutableOutcome.value = DeskPayOutcome.Saved
    }

    private fun dueOf(invoiceId: String): Long =
        (mutableState.value as? DeskPayState.Ready)?.dues?.firstOrNull { it.id == invoiceId }?.balancePaise
            ?: Long.MAX_VALUE

    private fun draftOf(invoiceId: String): Boolean =
        (mutableState.value as? DeskPayState.Ready)?.dues?.firstOrNull { it.id == invoiceId }?.draft == true

    private companion object {
        const val BILLING_READ = "billing.read"
        const val BILLING_WRITE = "billing.write"
    }
}

/**
 * What is due on a bill: an issued bill's balance, or a draft's total (the draft reads a balance of 0
 * until it is issued). Void, paid and empty bills are not due.
 */
internal fun dueBillOf(
    id: String,
    number: String?,
    status: String,
    totalPaise: Long,
    balancePaise: Long,
): DueBill? =
    when {
        status == "issued" && balancePaise > 0 -> DueBill(id, number, balancePaise)
        status == "draft" && totalPaise > 0 -> DueBill(id, number, totalPaise, draft = true)
        else -> null
    }

/** A `ready_to_bill` token whose visit ended within the last 2 minutes: the doctor may still be collecting. */
internal fun doctorMayBeCollecting(
    tokenStatus: String,
    visitEndedAt: Instant?,
    now: Instant,
): Boolean =
    tokenStatus == "ready_to_bill" && visitEndedAt != null &&
        (now - visitEndedAt).let { it >= 0.minutes && it < 2.minutes }
