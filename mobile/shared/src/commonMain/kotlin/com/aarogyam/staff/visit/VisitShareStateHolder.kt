package com.aarogyam.staff.visit

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.shareVisit
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the "Share visit summary" action draws. */
sealed interface VisitShareState {
    data object Idle : VisitShareState

    data object Creating : VisitShareState

    /** [url] and [pin] are shown once; the PIN is sent apart from the link. */
    data class Ready(
        val url: String,
        val pin: String,
    ) : VisitShareState

    data class Failed(
        val error: ScreenError,
    ) : VisitShareState
}

/**
 * `POST /visits/{id}/share` (clinical.read): a seven-day link to the visit summary and its PIN.
 * The patient's name is never part of the link or its message.
 */
class VisitShareStateHolder(
    private val clinic: ClinicContext,
    private val visitId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.visitshare"),
) {
    private val mutableState = MutableStateFlow<VisitShareState>(VisitShareState.Idle)
    val state: StateFlow<VisitShareState> = mutableState.asStateFlow()

    /** Makes the link; a tap while one is being made does nothing. */
    fun share() {
        if (mutableState.value == VisitShareState.Creating || "clinical.read" !in clinic.permissions) return
        mutableState.value = VisitShareState.Creating
        scope.launch {
            mutableState.value =
                when (val result = clinic.api.shareVisit(visitId)) {
                    is Outcome.Success -> {
                        log.info("visit.shared") { id("visit", visitId) }
                        VisitShareState.Ready("${clinic.api.origin}/shared/${result.value.token}", result.value.pin)
                    }

                    is Outcome.Failure -> {
                        log.warn("visit.share_failed") { code("error", result.error.code.value) }
                        VisitShareState.Failed(ScreenError.of(result.error))
                    }
                }
        }
    }
}
