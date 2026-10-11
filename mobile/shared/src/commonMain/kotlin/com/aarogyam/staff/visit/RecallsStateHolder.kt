package com.aarogyam.staff.visit

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.createRecall
import com.aarogyam.staff.api.listRecalls
import com.aarogyam.staff.api.model.NewRecall
import com.aarogyam.staff.api.model.Recall
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One planned follow-up. [reason] is clinical text: show it, never log it. */
data class RecallView(
    val id: String,
    val dueOn: String,
    val kind: String,
    val reason: String,
    val status: String,
)

data class RecallsState(
    val allowed: Boolean = true,
    val loading: Boolean = false,
    val items: List<RecallView> = emptyList(),
    val creating: Boolean = false,
    val error: ScreenError? = null,
)

/**
 * A patient's open follow-ups. The server lists every open recall of the clinic
 * (`GET /recalls`), so the list is filtered to [patientId] here.
 */
class RecallsStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.recalls"),
) {
    private val mutableState =
        MutableStateFlow(RecallsState(allowed = "patients.read" in clinic.permissions))
    val state: StateFlow<RecallsState> = mutableState.asStateFlow()

    fun load() {
        if (!mutableState.value.allowed) return
        mutableState.update { it.copy(loading = true, error = null) }
        scope.launch {
            when (val answer = clinic.api.listRecalls()) {
                is Outcome.Success ->
                    mutableState.update {
                        it.copy(
                            loading = false,
                            items = answer.value.items.filter { r -> r.patient.id == patientId }.map(Recall::toView),
                        )
                    }

                is Outcome.Failure -> {
                    log.warn("recalls.load_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(loading = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    /** Plans a follow-up on [dueOn] (`YYYY-MM-DD`); [reason] is 1 to 300 characters. */
    fun create(
        dueOn: String,
        reason: String,
    ) {
        if (!mutableState.value.allowed || mutableState.value.creating) return
        mutableState.update { it.copy(creating = true, error = null) }
        scope.launch {
            val failure = createRecallFor(clinic, patientId, dueOn, reason)
            if (failure == null) load()
            mutableState.update { it.copy(creating = false, error = failure?.let(ScreenError::of)) }
        }
    }
}

private fun Recall.toView() = RecallView(id, dueOn, kind, reason, status)

/** Creates the follow-up; the error, or null when it was saved. Shared with the visit's close. */
internal suspend fun createRecallFor(
    clinic: ClinicContext,
    patientId: String,
    dueOn: String,
    reason: String,
): com.sakalya.mobile.core.ApiError? =
    when (val answer = clinic.api.createRecall(patientId, NewRecall(dueOn = dueOn, reason = reason.take(300)))) {
        is Outcome.Success -> null
        is Outcome.Failure -> answer.error
    }
