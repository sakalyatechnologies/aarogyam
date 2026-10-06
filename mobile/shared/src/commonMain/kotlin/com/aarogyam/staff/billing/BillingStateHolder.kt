package com.aarogyam.staff.billing

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.Allocation
import com.aarogyam.staff.api.model.NewPayment
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.Submission
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The "record a payment" sheet. [amountText] starts at the bill's balance as it is now. [amountInvalid]
 * flags an amount that is not more than zero; [error] is the last failed attempt, which a retry replaces.
 */
data class PaymentForm(
    val billId: String,
    val billNumber: String?,
    val balancePaise: Long,
    val amountText: String,
    val method: PayMethod = PayMethod.Cash,
    val reference: String = "",
    val submitting: Boolean = false,
    val amountInvalid: Boolean = false,
    val error: ScreenError? = null,
)

/** What the Billing tab draws. */
sealed interface BillingState {
    data object Loading : BillingState

    /** The role lacks `billing.read`: the tab is not shown and nothing was requested. */
    data object Hidden : BillingState

    data class Failed(
        val error: ScreenError,
    ) : BillingState

    /**
     * [canRecord] is true with `billing.write`. [form] is the open payment sheet, and [receipt] the
     * number of the payment just recorded, for a confirmation.
     */
    data class Loaded(
        val view: BillingView,
        val canRecord: Boolean,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
        val form: PaymentForm? = null,
        val receipt: String? = null,
    ) : BillingState
}

/**
 * One patient's bills: one `GET /invoices?patient_id=` per load. A payment is a `POST /payments`
 * with an idempotency key that stays the same across retries of one submission and changes when
 * the person edits the form or after a success, so a lost answer never records twice.
 */
class BillingStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.billing"),
) {
    private val mutableState = MutableStateFlow<BillingState>(BillingState.Loading)
    private val submission = Submission()
    private val canWrite = BILLING_WRITE in clinic.permissions

    /** The current tab state. */
    val state: StateFlow<BillingState> = mutableState.asStateFlow()

    init {
        if (BILLING_READ in clinic.permissions) refresh() else mutableState.value = BillingState.Hidden
    }

    /** Reloads, keeping what is on screen until the answer arrives. */
    fun refresh() {
        val current = mutableState.value
        when (current) {
            BillingState.Hidden -> {
                return
            }

            is BillingState.Loaded -> {
                if (current.refreshing) return
                mutableState.value = current.copy(refreshing = true, error = null)
            }

            else -> {
                mutableState.value = BillingState.Loading
            }
        }
        scope.launch { load() }
    }

    private suspend fun load() {
        when (val result = clinic.api.invoices(patientId)) {
            is Outcome.Success -> {
                val bills = result.value.items.mapNotNull { it.toBill(clinic.timeZone, canWrite) }
                val current = mutableState.value as? BillingState.Loaded
                mutableState.value =
                    BillingState.Loaded(
                        view = bills.toView(),
                        canRecord = canWrite,
                        form = current?.form,
                        receipt = current?.receipt,
                    )
            }

            is Outcome.Failure -> {
                log.warn("billing.load_failed") {
                    id("patient", patientId)
                    code("error", result.error.code.value)
                }
                val error = ScreenError.of(result.error)
                val current = mutableState.value as? BillingState.Loaded
                mutableState.value = current?.copy(refreshing = false, error = error) ?: BillingState.Failed(error)
            }
        }
    }

    /** Opens the payment sheet on [billId], with the amount at that bill's current balance. */
    fun startPayment(billId: String) {
        val current = mutableState.value as? BillingState.Loaded ?: return
        val bill = current.view.bills.firstOrNull { it.id == billId && it.canRecordPayment } ?: return
        submission.reset()
        mutableState.value =
            current.copy(
                receipt = null,
                form = PaymentForm(bill.id, bill.number, bill.balancePaise, rupeesText(bill.balancePaise)),
            )
    }

    /** Closes the payment sheet without recording. */
    fun cancelPayment() = editForm { null }

    fun setAmount(text: String) = editForm { it.copy(amountText = text, amountInvalid = false, error = null) }

    fun setMethod(method: PayMethod) = editForm { it.copy(method = method, error = null) }

    fun setReference(text: String) = editForm { it.copy(reference = text, error = null) }

    /** Clears the receipt confirmation once the screen has shown it. */
    fun dismissReceipt() {
        val current = mutableState.value as? BillingState.Loaded ?: return
        mutableState.value = current.copy(receipt = null)
    }

    private fun editForm(change: (PaymentForm) -> PaymentForm?) {
        val current = mutableState.value as? BillingState.Loaded ?: return
        val form = current.form ?: return
        if (form.submitting) return
        // What is submitted changed, so it is a new payment and gets a new key.
        submission.reset()
        mutableState.value = current.copy(form = change(form))
    }

    /** Records the payment; a second tap while one is in flight does nothing. */
    fun submitPayment() {
        val current = mutableState.value as? BillingState.Loaded ?: return
        val form = current.form ?: return
        if (form.submitting || !canWrite) return
        val amount = parseRupees(form.amountText)
        if (amount == null) {
            mutableState.value = current.copy(form = form.copy(amountInvalid = true))
            return
        }
        mutableState.value = current.copy(form = form.copy(submitting = true, amountInvalid = false, error = null))
        val payment =
            NewPayment(
                patientId = patientId,
                method = form.method.wire,
                amountPaise = amount,
                allocations =
                    listOf(
                        Allocation(invoiceId = form.billId, amountPaise = minOf(amount, form.balancePaise)),
                    ),
                reference = form.reference.trim().ifEmpty { null },
            )
        scope.launch {
            when (val result = submission.run { clinic.api.recordPayment(payment, it) }) {
                is Outcome.Success -> {
                    log.info("billing.payment_recorded") { id("payment", result.value.id) }
                    val now = mutableState.value as? BillingState.Loaded
                    if (now != null) {
                        mutableState.value =
                            now.copy(form = null, receipt = result.value.number, refreshing = true, error = null)
                    }
                    load()
                }

                is Outcome.Failure -> {
                    paymentFailed(result.error)
                }
            }
        }
    }

    private fun paymentFailed(error: ApiError) {
        log.warn("billing.payment_failed") { code("error", error.code.value) }
        val now = mutableState.value as? BillingState.Loaded ?: return
        mutableState.value = now.copy(form = now.form?.copy(submitting = false, error = ScreenError.of(error)))
    }

    private companion object {
        const val BILLING_READ = "billing.read"
        const val BILLING_WRITE = "billing.write"
    }
}
