package com.aarogyam.staff.desk

import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.outbox.OutboxKind
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * One bill with something to pay. Amounts are paise. A [draft] is issued first (its [balancePaise]
 * is the draft's total, a preview: the issued total may differ by tax and round-off).
 */
data class DueBill(
    val id: String,
    val number: String?,
    val balancePaise: Long,
    val draft: Boolean = false,
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
) {
    private val allowed = BILLING_READ in clinic.permissions && BILLING_WRITE in clinic.permissions
    private val canProof = BILLING_WRITE in clinic.permissions
    private val runner = graph.outbox
    private val mutableState =
        MutableStateFlow<DeskPayState>(if (allowed) DeskPayState.Loading else DeskPayState.NotAllowed)
    private val mutableOutcome = MutableStateFlow<DeskPayOutcome>(DeskPayOutcome.Idle)

    // One key per submission: kept while the same payment is retried, replaced when it changes.
    private var keyed: Pair<String, String>? = null

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

    private fun load() {
        scope.launch {
            when (val result = clinic.api.invoices(patientId)) {
                is Outcome.Success -> {
                    val dues =
                        result.value.items
                            .mapNotNull { dueBillOf(it.id, it.number, it.status, it.totalPaise, it.balancePaise) }
                    mutableState.value = DeskPayState.Ready(dues, canProof)
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
            when (val delivery = deliver(clinic.api, job, key, log)) {
                is Delivery.Done -> {
                    keyed = null
                    mutableOutcome.value = DeskPayOutcome.Recorded(delivery.number, delivery.proof)
                    load()
                }

                is Delivery.Retry -> {
                    save(job, key)
                }

                is Delivery.Rejected -> {
                    mutableOutcome.value = DeskPayOutcome.Failed(delivery.error)
                }
            }
        }
    }

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
