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

/** One issued bill with something left to pay. Amounts are paise. */
data class DueBill(
    val id: String,
    val number: String?,
    val balancePaise: Long,
)

/** What the collect-payment sheet draws before a payment is sent. */
sealed interface DeskPayState {
    data object Loading : DeskPayState

    /** The role lacks `billing.read` or `billing.write`; nothing was requested. */
    data object NotAllowed : DeskPayState

    data class Failed(
        val error: ScreenError,
    ) : DeskPayState

    /** [canAttachProof] needs `clinical.write` until BE6 gives payments their own proof upload. */
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
 * drops mid-send, the payment goes to the desk outbox ([DeskOutbox]) with the same key and the
 * sheet shows "Saved, will send". An optional proof photo is uploaded as a patient attachment
 * labelled Report or Other until BE6 adds `attachment_id` to payments.
 */
class DeskPaymentStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val graph: AppGraph,
    private val log: Logger = Logger("aarogyam.deskpay"),
) {
    private val allowed = BILLING_READ in clinic.permissions && BILLING_WRITE in clinic.permissions
    private val canProof = CLINICAL_WRITE in clinic.permissions
    private val runner = DeskOutbox.runner(graph, clinic)
    private val mutableState = MutableStateFlow<DeskPayState>(if (allowed) DeskPayState.Loading else DeskPayState.NotAllowed)
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
                            .filter { it.status == "issued" && it.balancePaise > 0 }
                            .map { DueBill(it.id, it.number, it.balancePaise) }
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
        proofLabel: String?,
    ) {
        if (!allowed || amountPaise <= 0 || mutableOutcome.value == DeskPayOutcome.Sending) return
        val proof = proofJpeg?.takeIf { canProof && it.isNotEmpty() }
        val job =
            PaymentJob(
                patientId = patientId,
                method = method.name,
                amountPaise = amountPaise,
                invoiceId = invoiceId,
                allocatedPaise = invoiceId?.let { id -> minOf(amountPaise, dueOf(id)) } ?: 0,
                proofId = proof?.let { IdempotencyKey.generate().toString() },
                proofLabel = proofLabel?.takeIf { proof != null },
                proofJpegBase64 = proof?.let(::encodeProof),
            )
        val fingerprint = "$invoiceId|$amountPaise|${method.name}|${proof?.size}|${job.proofLabel}"
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
        (mutableState.value as? DeskPayState.Ready)?.dues?.firstOrNull { it.id == invoiceId }?.balancePaise ?: Long.MAX_VALUE

    private companion object {
        const val BILLING_READ = "billing.read"
        const val BILLING_WRITE = "billing.write"
        const val CLINICAL_WRITE = "clinical.write"
    }
}
