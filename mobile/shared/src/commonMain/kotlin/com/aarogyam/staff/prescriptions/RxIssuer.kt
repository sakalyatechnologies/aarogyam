package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The Rx sheet's server steps (draft, issue, share), on the sheet's own state. For issue and share,
 * [RxSheetStateHolder] checks that the step may start and freezes the lines, then calls in here.
 */
internal class RxIssuer(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val mutableState: MutableStateFlow<RxSheetState>,
    private val sync: RxDraftSync,
    private val scope: CoroutineScope,
    private val log: Logger,
) {
    fun saveDraft() {
        val current = mutableState.value
        if (!current.allowed || current.phase != RxPhase.Composing || current.lines.isEmpty()) return
        if (current.draft == DraftSave.Saving) return
        mutableState.update { it.copy(draft = DraftSave.Saving, error = null) }
        scope.launch {
            when (val result = sync.push(mutableState.value.lines)) {
                is Outcome.Success -> {
                    log.info("rxsheet.draft_saved") { id("prescription", result.value) }
                    mutableState.update { it.copy(draft = DraftSave.Saved) }
                }

                is Outcome.Failure -> {
                    log.warn("rxsheet.draft_failed") { code("error", result.error.code.value) }
                    mutableState.update { it.copy(draft = DraftSave.Failed, error = ScreenError.of(result.error)) }
                }
            }
        }
    }

    /** Saves the current lines as the server draft and returns its id; the existing id when empty; null on failure. */
    suspend fun saveDraftNow(): String? {
        val lines = mutableState.value.lines
        if (lines.isEmpty()) return sync.id
        return when (val result = sync.push(lines)) {
            is Outcome.Success -> {
                mutableState.update { it.copy(draft = DraftSave.Saved) }
                result.value
            }

            is Outcome.Failure -> {
                null
            }
        }
    }

    /** Drafts (once), issues and then creates the share link. Shows what went wrong; a retry resumes. */
    fun issue() {
        val current = mutableState.value
        mutableState.update { it.copy(phase = RxPhase.Issuing, error = null) }
        scope.launch {
            val id = sync.id ?: createDraft() ?: return@launch
            val reason = current.overrideReason.trim().takeIf { current.needsOverride }
            when (val result = clinic.api.issuePrescription(id, reason)) {
                is Outcome.Success -> {
                    log.info("rxsheet.issued") { id("prescription", id) }
                    mutableState.update {
                        it.copy(
                            phase = RxPhase.Issued,
                            issued = IssuedRx(id, result.value.number, clinic.session.clinic.name),
                        )
                    }
                    share()
                }

                is Outcome.Failure -> {
                    val blocked = result.error.body
                    if (blocked != null && blocked.code == ALLERGY_ALERTS) {
                        log.info("rxsheet.allergy_alert") { id("prescription", id) }
                        val alerts = blocked.alerts.map { ServerAlert(severityOf(it.severity), it.message) }
                        mutableState.update {
                            it.copy(phase = RxPhase.Composing, serverAlert = true, serverAlerts = alerts)
                        }
                    } else {
                        fail(result.error.error)
                    }
                }
            }
        }
    }

    /**
     * Sends an already issued prescription again (Visit detail): opens the delivery step for [id] and
     * makes a fresh link and PIN. Does nothing while composing or once a prescription is set.
     */
    fun shareIssued(
        id: String,
        number: String?,
    ) {
        mutableState.update {
            it.copy(phase = RxPhase.Issued, issued = IssuedRx(id, number, clinic.session.clinic.name))
        }
        share()
    }

    /** Creates the patient's link and PIN for the issued prescription; call again after a failure. */
    fun share() {
        val issued = mutableState.value.issued ?: return
        if (mutableState.value.share is ShareState.Creating) return
        mutableState.update { it.copy(share = ShareState.Creating) }
        scope.launch {
            when (val result = shareView(clinic, issued.id)) {
                is Outcome.Success -> {
                    mutableState.update { it.copy(share = ShareState.Ready(result.value)) }
                }

                is Outcome.Failure -> {
                    log.warn("rxsheet.share_failed") {
                        id("prescription", issued.id)
                        code("error", result.error.code.value)
                    }
                    mutableState.update { it.copy(share = ShareState.Failed(ScreenError.of(result.error))) }
                }
            }
        }
    }

    private suspend fun createDraft(): String? =
        when (val result = sync.push(mutableState.value.lines)) {
            is Outcome.Success -> {
                result.value
            }

            is Outcome.Failure -> {
                fail(result.error)
                null
            }
        }

    private fun fail(error: ApiError) {
        log.warn("rxsheet.issue_failed") {
            id("patient", patientId)
            code("error", error.code.value)
        }
        mutableState.update { it.copy(phase = RxPhase.Composing, error = ScreenError.of(error)) }
    }
}
