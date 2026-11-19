package com.aarogyam.staff.android.ui.visit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.prescriptions.RxSheetStateHolder
import com.aarogyam.staff.visit.FinishOutcome
import com.aarogyam.staff.visit.FinishPhase
import com.aarogyam.staff.visit.FinishSources
import com.aarogyam.staff.visit.FinishedSummary
import com.aarogyam.staff.visit.FollowUpChoice
import com.aarogyam.staff.visit.RxSave
import com.aarogyam.staff.visit.VisitStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private fun FollowUpChoice.label(): Int =
    when (this) {
        FollowUpChoice.OneWeek -> R.string.vv_dv10_fu_oneweek
        FollowUpChoice.TwoWeeks -> R.string.vv_dv10_fu_twoweeks
        FollowUpChoice.OneMonth -> R.string.vv_dv10_fu_onemonth
        FollowUpChoice.SixMonths -> R.string.vv_dv10_fu_sixmonths
        FollowUpChoice.NotNeeded -> R.string.vv_dv10_fu_none
    }

/** Wrap up: follow-up and fee, issue the Rx draft, then one finish. Staged treatments are saved first. */
@Composable
internal fun WrapUpSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    visitId: String,
    visit: VisitStateHolder,
    rx: RxSheetStateHolder,
    saveStaged: suspend () -> Boolean,
    onCollect: (invoiceId: String?) -> Unit,
    onClose: () -> Unit,
) {
    val finish = rememberHolder { graph.finishVisit(clinic, visitId, it) }
    val state by finish.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val sources =
        remember {
            FinishSources(
                patientId = patientId,
                saveNote = { visit.saveNow() },
                saveRx = {
                    val id = rx.saveDraftNow()
                    if (id != null ||
                        rx.state.value.lines
                            .isEmpty()
                    ) {
                        RxSave.Saved(id)
                    } else {
                        RxSave.Failed
                    }
                },
                rxDraftId = { rx.draftId },
            )
        }
    LaunchedEffect(Unit) {
        finish.attach(sources)
        if (rx.state.value.lines
                .isNotEmpty()
        ) {
            rx.saveDraftNow()
        }
        finish.attach(sources)
    }
    var feeText by remember { mutableStateOf("") }
    var feeTouched by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var stagedFailed by remember { mutableStateOf(false) }
    LaunchedEffect(state.feePaise) { if (!feeTouched) feeText = VisitMoney.feeText(state.feePaise) }
    val phase = state.phase

    fun go(collect: Boolean) {
        if (saving) return
        saving = true
        stagedFailed = false
        scope.launch {
            val saved = saveStaged()
            saving = false
            if (!saved) return@launch run { stagedFailed = true }
            if (phase is FinishPhase.NeedsConnection || phase is FinishPhase.Failed) finish.backToEditing()
            finish.finish(collect)
        }
    }
    SkBottomSheet(title = stringResource(R.string.vv_dv10_wrap_title), onDismiss = onClose) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp)) {
            when (phase) {
                is FinishPhase.Done -> {
                    Celebration(
                        phase.summary,
                        clinic.billsLater,
                        onCollect,
                        onClose,
                    ) { WhatsAppSummary(clinic, visitId) }
                }

                FinishPhase.Finishing -> {
                    Muted(stringResource(R.string.vv_dv10_wrap_finishing))
                }

                FinishPhase.Queued -> {
                    Banner(stringResource(R.string.vv_dv10_wrap_queued), error = false)
                    SkButton(
                        stringResource(R.string.vv_dv10_done_button),
                        onClick = onClose,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                else -> {
                    Muted(stringResource(R.string.vv_dv10_wrap_followup))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                        FollowUpChoice.entries.forEach { choice ->
                            VisitChip(
                                stringResource(choice.label()),
                                state.followUp == choice,
                            ) { finish.pickFollowUp(choice) }
                        }
                    }
                    SkTextField(
                        feeText,
                        { text ->
                            feeText = text
                            feeTouched = true
                            finish.setFee(VisitMoney.feePaise(text))
                        },
                        stringResource(R.string.vv_dv10_wrap_fee),
                        placeholder = stringResource(R.string.vv_dv10_wrap_fee_hint),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            stringResource(
                                if (state.hasRxDraft) R.string.vv_dv10_wrap_rx else R.string.vv_dv10_wrap_rx_none,
                            ),
                            style = SkTypography.bodyStrong,
                            color = SkTheme.colors.text.color,
                        )
                        Switch(state.issueRx, finish::setIssueRx, enabled = state.hasRxDraft)
                    }
                    PhaseNotes(phase, reason) {
                        reason = it
                        finish.setOverrideReason(it)
                    }
                    if (stagedFailed) Banner(stringResource(R.string.vv_v9v_close_procedures_failed), error = true)
                    val canFinish = phase !is FinishPhase.NeedsOverride || reason.isNotBlank()
                    SkButton(
                        stringResource(R.string.vv_dv10_wrap_collect),
                        onClick = { go(true) },
                        enabled =
                            canFinish && !saving,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    // Nobody else collects: the second way is "Bill later" (the same finish), not the desk.
                    SkButton(
                        stringResource(
                            if (clinic.billsLater) R.string.vv_dv10_wrap_bill_later else R.string.vv_dv10_wrap_desk,
                        ),
                        onClick = { go(false) },
                        variant = SkButtonVariant.Secondary,
                        enabled =
                            canFinish && !saving,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

@Composable
private fun PhaseNotes(
    phase: FinishPhase,
    reason: String,
    onReason: (String) -> Unit,
) {
    when (phase) {
        is FinishPhase.NeedsOverride -> {
            Text(
                stringResource(R.string.vv_dv10_wrap_override_title),
                style = SkTypography.headline,
                color = SkTheme.colors.dangerText.color,
            )
            phase.alerts.forEach { Text(it.message, style = SkTypography.callout, color = SkTheme.colors.text.color) }
            SkTextField(
                reason,
                onReason,
                stringResource(R.string.vv_dv10_wrap_override_reason),
                singleLine = false,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        FinishPhase.NeedsConnection -> {
            Banner(stringResource(R.string.vv_dv10_wrap_offline), error = true)
        }

        is FinishPhase.Failed -> {
            Banner(phase.message, error = true)
        }

        else -> {}
    }
}

@Composable
private fun Banner(
    text: String,
    error: Boolean,
) {
    val colors = SkTheme.colors
    Text(
        text,
        style = SkTypography.bodyStrong,
        color = if (error) colors.dangerText.color else colors.primaryText.color,
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Spacing.L.dp))
                .background(if (error) colors.dangerSoft.color else colors.brandSoft.color)
                .padding(Spacing.M.dp),
    )
}

@Composable
private fun Celebration(
    summary: FinishedSummary,
    billsLater: Boolean,
    onCollect: (String?) -> Unit,
    onClose: () -> Unit,
    whatsApp: @Composable () -> Unit,
) {
    val collected = summary.outcome == FinishOutcome.Collected
    val parts = mutableListOf(stringResource(R.string.vv_dv10_done_visit))
    if (summary.rxIssued) parts += stringResource(R.string.vv_dv10_done_rx)
    summary.followUpOn?.let { parts += stringResource(R.string.vv_dv10_done_followup, shortDate(it)) }
    val total = summary.invoiceTotalPaise
    if (total != null && total > 0) {
        val amount = VisitMoney.rupees(total)
        val text =
            when {
                collected -> R.string.vv_dv10_done_collect
                billsLater -> R.string.vv_dv10_done_later
                else -> R.string.vv_dv10_done_desk
            }
        parts += stringResource(text, amount)
    } else if (!collected && !billsLater) {
        parts += stringResource(R.string.vv_dv10_done_desk_nofee)
    }
    Text("✓", style = SkTypography.largeTitle, color = SkTheme.colors.primary.color, modifier = Modifier.fillMaxWidth())
    Text(parts.joinToString(" · "), style = SkTypography.headline, color = SkTheme.colors.text.color)
    if (collected && summary.invoiceId != null) {
        SkButton(stringResource(R.string.vv_dv10_done_pay), onClick = {
            onCollect(summary.invoiceId)
        }, variant = SkButtonVariant.Secondary, modifier = Modifier.fillMaxWidth())
    }
    whatsApp()
    SkButton(stringResource(R.string.vv_dv10_done_button), onClick = onClose, modifier = Modifier.fillMaxWidth())
}

/** `2026-11-01` as a short date in the person's language; the text itself when it is not a date. */
private fun shortDate(iso: String): String =
    runCatching { LocalDate.parse(iso.take(ISO_DAY)).format(DateTimeFormatter.ofPattern("d MMM")) }.getOrDefault(iso)

private const val ISO_DAY = 10
