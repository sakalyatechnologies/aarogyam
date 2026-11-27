package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.PinnedSheet
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.desk.DeskPayOutcome
import com.aarogyam.staff.desk.DeskPayState
import com.aarogyam.staff.desk.DeskPaymentStateHolder
import com.aarogyam.staff.desk.DueBill
import com.aarogyam.staff.desk.ProofStatus
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * Collect payment for a patient: the bill, the amount, how it was paid (UPI, cash or card) and an optional proof
 * photo. Online it records at once with an idempotency key; offline it is saved on the phone and goes out later.
 * [refreshTick] changes on every live refresh, so the sheet re-checks whether someone else collected (A10).
 */
@Composable
fun DeskPaymentSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    target: DeskPayTarget,
    refreshTick: Int,
    onDismiss: () -> Unit,
) {
    // Half height first (the form is short); drag up for the proof photo and long bill lists.
    PinnedSheet(
        title = stringResource(R.string.dk_d9_pay_title),
        subtitle = target.name,
        onDismiss = onDismiss,
        partial = true,
        scrolls = false,
    ) {
        DeskPaymentBody(graph, clinic, target, refreshTick, onDismiss)
    }
}

/** The sheet's content, also used by the full-screen route. */
@Composable
fun DeskPaymentBody(
    graph: AppGraph,
    clinic: ClinicContext,
    target: DeskPayTarget,
    refreshTick: Int,
    onDone: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val holder =
        remember(target.patientId, target.invoiceId) {
            DeskPaymentStateHolder(clinic, target.patientId, scope, graph, invoiceId = target.invoiceId)
        }
    val state by holder.state.collectAsStateWithLifecycle()
    val outcome by holder.outcome.collectAsStateWithLifecycle()
    val pending by holder.pending.collectAsStateWithLifecycle()
    val cardOpen by holder.cardOpen.collectAsStateWithLifecycle()
    val online by graph.connectivity.online.collectAsStateWithLifecycle()
    // Someone else collected it (handled, or no balance): close, unless this sheet is showing its own result.
    LaunchedEffect(cardOpen) { if (!cardOpen && holder.outcome.value == DeskPayOutcome.Idle) onDone() }
    LaunchedEffect(refreshTick) { target.notificationId?.let(holder::checkHandled) }
    Column(
        Modifier.verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
    ) {
        if (pending > 0 &&
            outcome !is DeskPayOutcome.Recorded
        ) {
            DeskMutedText(stringResource(R.string.dk_d9_pay_pending, pending))
        }
        when (val done = outcome) {
            is DeskPayOutcome.Recorded -> {
                RecordedCard(done, onDone)
            }

            DeskPayOutcome.Saved -> {
                MessageCard(R.string.dk_d9_pay_saved, R.string.dk_d9_pay_saved_message, onDone)
            }

            DeskPayOutcome.AlreadyPaid -> {
                MessageCard(
                    R.string.dk_d9_pay_already,
                    R.string.dk_d9_pay_already_message,
                    onDone,
                )
            }

            else -> {
                PayForm(holder, state, outcome, online)
            }
        }
    }
}

@Composable
private fun PayForm(
    holder: DeskPaymentStateHolder,
    state: DeskPayState,
    outcome: DeskPayOutcome,
    online: Boolean,
) {
    when (state) {
        DeskPayState.Loading -> {
            LoadingIndicator()
        }

        DeskPayState.NotAllowed -> {
            SkEmptyState(
                stringResource(R.string.dk_d9_pay_not_allowed_title),
                stringResource(R.string.dk_d9_pay_not_allowed_message),
            )
        }

        is DeskPayState.Failed -> {
            SkEmptyState(
                stringResource(R.string.dk_d9_pay_title),
                stringResource(state.error.message()),
                actionLabel = stringResource(R.string.try_again),
                onAction = holder::refresh,
            )
        }

        is DeskPayState.Ready -> {
            if (state.dues.isEmpty()) {
                SkEmptyState(
                    stringResource(R.string.dk_d9_pay_none_title),
                    stringResource(R.string.dk_d9_pay_none_message),
                )
            } else {
                Fields(holder, state, outcome, online)
            }
        }
    }
}

@Composable
private fun Fields(
    holder: DeskPaymentStateHolder,
    ready: DeskPayState.Ready,
    outcome: DeskPayOutcome,
    online: Boolean,
) {
    val dues = ready.dues
    // Several issued bills: Collect for the patient as a whole, one payment split oldest bill first.
    val splitBills = remember(dues) { holder.splitBills() }
    val canSplit = splitBills.size > 1
    val allTotal = splitBills.sumOf { it.balancePaise }
    var invoiceId by remember { mutableStateOf<String?>(if (canSplit) ALL_BILLS else null) }
    val all = canSplit && invoiceId == ALL_BILLS
    val chosen = dues.firstOrNull { it.id == invoiceId } ?: dues.first()
    var amount by remember(if (all) ALL_BILLS else chosen.id) {
        mutableStateOf(DeskPay.rupeesText(if (all) allTotal else chosen.balancePaise))
    }
    var method by remember { mutableStateOf<PayMethod?>(PayMethod.Cash) }
    var showProblems by remember { mutableStateOf(false) }
    var proof by remember { mutableStateOf<ByteArray?>(null) }
    val problems = if (showProblems) DeskPay.problems(amount, method != null) else emptyList()
    if (!online) DeskNotice(stringResource(R.string.dk_d9_pay_offline))
    BillPicker(dues, chosen, allTotal.takeIf { canSplit }, all) { invoiceId = it }
    if (!all && chosen.draft) {
        Text(
            stringResource(R.string.dk_d9_pay_draft_note),
            style = SkTypography.footnote,
            color = SkTheme.colors.textMuted.color,
            maxLines = 1,
        )
    }
    SkTextField(
        value = amount,
        onValueChange = {
            amount = it
            holder.dismissOutcome()
        },
        label = stringResource(R.string.dk_d9_pay_amount),
        isError = DeskPayProblem.Amount in problems,
        supportingText =
            if (DeskPayProblem.Amount in
                problems
            ) {
                stringResource(R.string.dk_d9_pay_amount_invalid)
            } else {
                null
            },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
    )
    DeskLabel(stringResource(R.string.dk_d9_pay_method))
    DeskWrap {
        PayMethod.entries.forEach { PickChip(stringResource(it.label()), method == it, onClick = { method = it }) }
    }
    if (DeskPayProblem.Method in problems) DeskErrorText(stringResource(R.string.dk_d9_pay_method_required))
    if (all) SplitPreview(holder, DeskPay.paise(amount) ?: 0) else UpiLinkSection(holder.upiLink, chosen)
    if (ServerCaps.paymentProof) ProofSection(ready.canAttachProof, proof) { proof = it }
    when (outcome) {
        is DeskPayOutcome.Failed -> {
            DeskErrorText(stringResource(outcome.error.message()))
        }

        is DeskPayOutcome.BalanceChanged -> {
            DeskErrorText(stringResource(R.string.dk_dx_pay_balance_changed, DeskPay.rupeesText(outcome.balancePaise)))
        }

        else -> {
            // Nothing to draw.
        }
    }
    SkButton(
        stringResource(R.string.dk_d9_pay_record),
        onClick = {
            showProblems = true
            val paise = DeskPay.paise(amount)
            val picked = method
            if (paise != null && picked != null) {
                if (all) holder.recordAll(paise, picked, proof) else holder.record(chosen.id, paise, picked, proof)
            }
        },
        enabled = outcome != DeskPayOutcome.Sending,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** What [amountPaise] does to each bill, oldest first, before it is saved; any rest is an advance. */
@Composable
private fun SplitPreview(
    holder: DeskPaymentStateHolder,
    amountPaise: Long,
) {
    val shares = holder.split(amountPaise)
    DeskLabel(stringResource(R.string.dk_dx_pay_split_title))
    shares.forEach { share ->
        DeskMutedText(listOfNotNull(share.number, share.amountPaise.rupees()).joinToString(" · "))
    }
    val rest = amountPaise - shares.sumOf { it.amountPaise }
    if (rest > 0) DeskMutedText(stringResource(R.string.dk_dx_pay_split_advance, rest.rupees()))
}

private const val ALL_BILLS = "all"

@Composable
private fun BillPicker(
    dues: List<DueBill>,
    chosen: DueBill,
    /** The issued bills' total when they can be paid together, else null. */
    allTotal: Long?,
    allPicked: Boolean,
    onPick: (String) -> Unit,
) {
    if (dues.size > 1) {
        DeskLabel(stringResource(R.string.dk_d9_pay_bill))
        DeskWrap {
            if (allTotal != null) {
                PickChip(
                    stringResource(R.string.dk_dx_pay_all, allTotal.rupees()),
                    allPicked,
                    onClick = { onPick(ALL_BILLS) },
                )
            }
            dues.forEach { due ->
                val text =
                    listOfNotNull(
                        due.number,
                        if (due.draft) stringResource(R.string.dk_d9_pay_draft_tag) else null,
                        due.balancePaise.rupees(),
                    ).joinToString(" · ")
                PickChip(text, !allPicked && due.id == chosen.id, onClick = { onPick(due.id) })
            }
        }
    } else {
        Text(
            stringResource(R.string.dk_d9_pay_due, chosen.balancePaise.rupees()),
            style = SkTypography.bodyStrong,
            color = SkTheme.colors.textMuted.color,
        )
    }
}

/** "Attach proof": the camera or the photo picker; the photo is saved as the payment's proof. */
@Composable
private fun ProofSection(
    allowed: Boolean,
    proof: ByteArray?,
    onProof: (ByteArray?) -> Unit,
) {
    DeskLabel(stringResource(R.string.dk_d9_pay_proof))
    if (!allowed) {
        DeskMutedText(stringResource(R.string.dk_d9_pay_proof_locked))
    } else {
        DeskPhotoPicker(
            proof,
            DeskPhotoLabels(
                stringResource(R.string.dk_d9_pay_camera),
                stringResource(R.string.dk_d9_pay_library),
                stringResource(R.string.dk_d9_pay_proof_remove),
                stringResource(R.string.dk_d9_pay_proof_photo_a11y),
            ),
            onProof,
        )
    }
}

@Composable
private fun RecordedCard(
    done: DeskPayOutcome.Recorded,
    onDone: () -> Unit,
) {
    Text(
        stringResource(R.string.dk_d9_pay_recorded_title),
        style = SkTypography.titleSmall,
        color = SkTheme.colors.text.color,
    )
    Text(
        stringResource(R.string.dk_d9_pay_recorded_message, done.number),
        style = SkTypography.bodyText,
        color = SkTheme.colors.textMuted.color,
    )
    when (done.proof) {
        ProofStatus.Sent -> DeskMutedText(stringResource(R.string.dk_d9_pay_proof_sent))
        ProofStatus.NotSent -> DeskErrorText(stringResource(R.string.dk_d9_pay_proof_not_sent))
        ProofStatus.None -> Unit
    }
    SkButton(stringResource(R.string.dk_d9_done), onClick = onDone, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun MessageCard(
    title: Int,
    message: Int,
    onDone: () -> Unit,
) {
    Text(stringResource(title), style = SkTypography.titleSmall, color = SkTheme.colors.text.color)
    Text(stringResource(message), style = SkTypography.bodyText, color = SkTheme.colors.textMuted.color)
    SkButton(stringResource(R.string.dk_d9_done), onClick = onDone, modifier = Modifier.fillMaxWidth())
}

private fun PayMethod.label(): Int =
    when (this) {
        PayMethod.Cash -> R.string.pay_cash
        PayMethod.Upi -> R.string.pay_upi
        PayMethod.Card -> R.string.pay_card
    }
