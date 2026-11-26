package com.aarogyam.staff.chart

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.addToothNote
import com.aarogyam.staff.api.model.NewToothNote
import com.aarogyam.staff.api.toothNotes
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.moment
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A past note on a tooth, with who wrote it and when. */
data class ToothNoteView(
    val id: String,
    val body: String,
    val by: String?,
    val at: ClinicMoment?,
)

data class ToothNotesState(
    /** Newest first. */
    val items: List<ToothNoteView> = emptyList(),
    val error: ScreenError? = null,
)

/**
 * The tooth's notes: its history, and saving the note being written (once, when the sheet closes;
 * empty notes are skipped).
 */
internal class ToothNotes(
    private val clinic: ClinicContext,
    private val chart: ChartStateHolder,
    private val scope: CoroutineScope,
    private val log: Logger,
) {
    private val mutable = MutableStateFlow(ToothNotesState())
    val state: StateFlow<ToothNotesState> = mutable.asStateFlow()

    fun open(tooth: Int) {
        mutable.value = ToothNotesState()
        scope.launch {
            val answer = clinic.api.toothNotes(chart.patientId, tooth)
            if (answer is Outcome.Success) {
                mutable.update { it.copy(items = answer.value.items.map { n -> n.view() }) }
            }
        }
    }

    /** Saves [text] as a new note on [tooth]; it finishes even if the sheet has gone. */
    fun save(
        tooth: Int,
        text: String,
    ) {
        val body = text.trim().take(MAX_NOTE)
        if (body.isEmpty()) return
        scope.launch {
            withContext(NonCancellable) {
                val request = NewToothNote(body = body, clientId = IdempotencyKey.generate().toString())
                when (val answer = clinic.api.addToothNote(chart.patientId, tooth, request)) {
                    is Outcome.Success -> {
                        log.info("chart.tooth_note_added")
                        mutable.update { it.copy(items = listOf(answer.value.view()) + it.items) }
                    }

                    is Outcome.Failure -> {
                        log.warn("chart.tooth_note_failed") { code("error", answer.error.code.value) }
                        mutable.update { it.copy(error = ScreenError.of(answer.error)) }
                    }
                }
            }
        }
    }

    private fun com.aarogyam.staff.api.model.ToothNote.view() =
        ToothNoteView(id, body, recordedByName, moment(recordedAt, clinic.timeZone))

    private companion object {
        const val MAX_NOTE = 2000
    }
}
