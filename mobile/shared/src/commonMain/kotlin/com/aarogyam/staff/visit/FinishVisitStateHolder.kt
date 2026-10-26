package com.aarogyam.staff.visit

import com.aarogyam.staff.api.model.CloseQueueStatus
import com.aarogyam.staff.api.model.FinishPrescription
import com.aarogyam.staff.api.model.FinishRequest
import com.aarogyam.staff.api.model.FinishedVisit
import com.aarogyam.staff.api.model.ShareRequest
import com.aarogyam.staff.api.visit
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.outbox.Queued
import com.aarogyam.staff.outbox.shouldQueue
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.plus
import kotlinx.datetime.todayIn
import kotlin.time.Clock

internal class FinishVisitStateHolder(
    private val clinic: ClinicContext,
    private val visitId: String,
    private val scope: CoroutineScope,
    private val today: () -> LocalDate = { Clock.System.todayIn(clinic.timeZone) },
    private val log: Logger = Logger("aarogyam.finish"),
) : FinishVisitHolder {
    private val mutableState = MutableStateFlow(FinishState())
    override val state: StateFlow<FinishState> = mutableState.asStateFlow()
    private var sources: FinishSources? = null
    private var issueChoice: Boolean? = null
    private var feeEdited = false
    private var overrideAsked = false

    init {
        scope.launch { prefillFee() }
    }

    override fun attach(sources: FinishSources) {
        this.sources = sources
        syncDraft()
    }

    override fun pickFollowUp(choice: FollowUpChoice) = edit { it.copy(followUp = choice) }

    override fun setFee(paise: Long?) {
        feeEdited = true
        edit { it.copy(feePaise = paise?.takeIf { p -> p > 0 }) }
    }

    override fun setIssueRx(on: Boolean) {
        issueChoice = on
        edit { it.copy(issueRx = on && it.hasRxDraft) }
    }

    override fun setOverrideReason(text: String) = edit { it.copy(overrideReason = text.take(MAX_REASON)) }

    override fun backToEditing() {
        if (mutableState.value.phase !is FinishPhase.Finishing) {
            mutableState.update { it.copy(phase = FinishPhase.Editing) }
        }
    }

    override fun finish(collectNow: Boolean) {
        val before = mutableState.value
        if (before.phase is FinishPhase.Finishing || before.phase is FinishPhase.Done ||
            before.phase is FinishPhase.Queued
        ) {
            return
        }
        if (before.phase is FinishPhase.NeedsOverride && before.overrideReason.isBlank()) return
        syncDraft()
        val s = mutableState.value
        val src = sources
        val rxId = src?.rxDraftId()?.takeIf { s.issueRx }
        val writes = src?.writes
        if (rxId != null && writes != null && !writes.online) {
            return update { it.copy(phase = FinishPhase.NeedsConnection) }
        }
        val reason = s.overrideReason.trim().takeIf { overrideAsked && it.isNotEmpty() }
        update { it.copy(phase = FinishPhase.Finishing) }
        scope.launch { run(s, src, rxId, reason, collectNow) }
    }

    private suspend fun run(
        s: FinishState,
        src: FinishSources?,
        rxId: String?,
        reason: String?,
        collectNow: Boolean,
    ) {
        val writes = src?.writes
        // 1. The note, then the Rx draft, so the server issues what is on screen.
        if (src != null &&
            !src.saveNote()
        ) {
            return failed(FinishFailure.NoteNotSaved, "The note could not be saved. Nothing was finished.")
        }
        var issueId = rxId
        if (src != null && (issueId != null || (s.hasRxDraft && writes?.online != false))) {
            when (val saved = src.saveRx()) {
                is RxSave.Saved -> {
                    if (issueId != null) issueId = saved.draftId ?: issueId
                }

                RxSave.Failed -> {
                    if (issueId !=
                        null
                    ) {
                        return failed(
                            FinishFailure.RxNotSaved,
                            "The prescription could not be saved. Nothing was finished.",
                        )
                    }
                }
            }
        }
        // 2. One finish, `ready_to_bill` for both buttons.
        val followUpOn = s.followUp.days?.let { today().plus(it, DateTimeUnit.DAY).toString() }
        val body =
            FinishRequest(
                followUpOn = followUpOn,
                feePaise = s.feePaise,
                prescription =
                    issueId?.let {
                        FinishPrescription(
                            id = it,
                            notifyPatient = false,
                            overrideReason = reason,
                            share = ShareRequest(channel = "link"),
                        )
                    },
                queueStatus = CloseQueueStatus.READY_TO_BILL,
            )
        if (issueId == null && writes != null && !writes.online) return queue(s, src, followUpOn)
        when (val answer = clinic.api.finishWithAlerts(visitId, body)) {
            is Outcome.Success -> {
                log.info("finish.done") { id("visit", visitId) }
                done(answer.value, collectNow, followUpOn)
            }

            is Outcome.Failure -> {
                val blocked = answer.error.body
                val error = answer.error.error
                when {
                    blocked != null && blocked.code == ALLERGY -> {
                        overrideAsked = true
                        val alerts = blocked.alerts.map { FinishAlert(it.severity, it.message) }
                        update { it.copy(phase = FinishPhase.NeedsOverride(alerts)) }
                    }

                    error.code.value == VISIT_CLOSED -> {
                        failed(FinishFailure.VisitClosed, VISIT_CLOSED_TEXT)
                    }

                    error.shouldQueue() && issueId != null -> {
                        update { it.copy(phase = FinishPhase.NeedsConnection) }
                    }

                    error.shouldQueue() && src != null -> {
                        queue(s, src, followUpOn)
                    }

                    error.status == FORBIDDEN -> {
                        failed(FinishFailure.NotAllowed, "This role cannot do everything asked here.")
                    }

                    else -> {
                        log.warn("finish.failed") { code("error", error.code.value) }
                        failed(FinishFailure.Other, "Couldn't finish the visit. Nothing was lost; try again.")
                    }
                }
            }
        }
    }

    /** No Rx to issue: the finish waits on the phone (the existing `VisitClose` job). */
    private fun queue(
        s: FinishState,
        src: FinishSources?,
        followUpOn: String?,
    ) {
        val writes = src?.writes ?: return update { it.copy(phase = FinishPhase.NeedsConnection) }
        when (writes.close(clinic.slug, visitId, src.patientId, followUpOn, null, s.feePaise)) {
            is Queued.Saved -> update { it.copy(outcome = FinishOutcome.SentToDesk, phase = FinishPhase.Queued) }
            is Queued.Refused -> failed(FinishFailure.Other, "Couldn't save the finish on this phone. Try again.")
        }
    }

    private fun done(
        finished: FinishedVisit,
        collectNow: Boolean,
        followUpOn: String?,
    ) {
        val invoice = finished.invoice
        val outcome = if (collectNow && invoice != null) FinishOutcome.Collected else FinishOutcome.SentToDesk
        val link = finished.share
        val summary =
            FinishedSummary(
                outcome = outcome,
                invoiceId = invoice?.id,
                invoiceTotalPaise = invoice?.totalPaise,
                followUpOn = finished.followUp?.dueOn ?: followUpOn,
                rxIssued = finished.prescription != null,
                rxNumber = finished.prescription?.number,
                share = if (link != null) ShareStatus.LinkReady else ShareStatus.NotShared,
                sharePin = link?.pin,
                shareToken = link?.token,
            )
        update { it.copy(outcome = outcome, phase = FinishPhase.Done(summary)) }
    }

    private fun failed(
        reason: FinishFailure,
        message: String,
    ) = update { it.copy(phase = FinishPhase.Failed(reason, message)) }

    private suspend fun prefillFee() {
        val answer = clinic.api.visit(visitId)
        if (answer !is Outcome.Success || feeEdited) return
        val total =
            answer.value.procedures
                .filter { it.errorReason == null && it.status !in UNBILLED }
                .sumOf { it.pricePaise ?: 0L }
        if (total > 0) update { if (feeEdited) it else it.copy(feePaise = total) }
    }

    private fun syncDraft() {
        val has = sources?.rxDraftId?.invoke() != null
        update { it.copy(hasRxDraft = has, issueRx = has && (issueChoice ?: true)) }
    }

    private fun edit(change: (FinishState) -> FinishState) =
        update {
            val next = change(it)
            if (next.phase is FinishPhase.Failed || next.phase == FinishPhase.NeedsConnection) {
                next.copy(phase = FinishPhase.Editing)
            } else {
                next
            }
        }

    private fun update(change: (FinishState) -> FinishState) = mutableState.update(change)

    private companion object {
        const val ALLERGY = "allergy_alerts"
        const val VISIT_CLOSED = "visit_closed"
        const val FORBIDDEN = 403
        const val MAX_REASON = 300
        val UNBILLED = setOf("cancelled", "canceled", "error", "entered_in_error")
        const val VISIT_CLOSED_TEXT =
            "This visit is already closed (it may have been finished on another screen). Reload the patient to see the final record."
    }
}
