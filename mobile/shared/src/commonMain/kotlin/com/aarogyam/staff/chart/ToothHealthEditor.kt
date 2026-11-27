package com.aarogyam.staff.chart

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.clearToothStatus
import com.aarogyam.staff.api.model.NewToothStatus
import com.aarogyam.staff.api.model.ToothHealth
import com.aarogyam.staff.api.setToothStatus
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.device.Dictation
import com.aarogyam.staff.device.DictationEvent
import com.aarogyam.staff.device.DictationLanguage
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Saving the doctor's health status on the tooth, and its one-line note being typed or dictated. */
data class HealthSaveState(
    val saving: Boolean = false,
    /** The last change was refused and taken back. */
    val error: ScreenError? = null,
    /** The note being written; [ToothSheetStateHolder.saveNote] saves it as a tooth note when the sheet closes. */
    val note: String = "",
    /** Dictating into the note, in this language. */
    val listening: DictationLanguage? = null,
    /** Words still being recognised. */
    val live: String? = null,
)

/**
 * The tooth sheet's health part: sets or clears the doctor's status (no visit needed), shown at once
 * and put back if refused, and the one-line note, typed or dictated and saved when dictation stops.
 */
internal class ToothHealthEditor(
    private val clinic: ClinicContext,
    private val chart: ChartStateHolder,
    private val scope: CoroutineScope,
    private val log: Logger,
    private val dictation: Dictation,
) {
    private val mutableHealth = MutableStateFlow(HealthSaveState())
    val state: StateFlow<HealthSaveState> = mutableHealth.asStateFlow()
    private var listenJob: Job? = null

    /**
     * Sets the doctor's health for [tooth]; no visit needed. [months] goes only with watch or needs
     * treatment. It shows at once; a refusal puts back what was there.
     */
    fun set(
        tooth: Int,
        level: HealthLevel,
        months: Int? = null,
        note: String? = null,
    ) {
        if (mutableHealth.value.saving) return
        val within = months?.takeIf { level.advisesTreatment && it in TREAT_WITHIN_MONTHS }
        val text = note?.trim()?.take(MAX_HEALTH_NOTE)?.ifEmpty { null }
        val before = chart.statusOf(tooth)
        chart.applyStatus(tooth, ToothStatusView(level, text, within, before?.at))
        mutableHealth.update { it.copy(saving = true, error = null) }
        scope.launch {
            val body =
                NewToothStatus(
                    health = ToothHealth.entries.first { it.value == level.wire },
                    clientId = IdempotencyKey.generate().toString(),
                    note = text,
                    treatWithinMonths = within?.toLong(),
                )
            when (val answer = clinic.api.setToothStatus(chart.patientId, tooth, body)) {
                is Outcome.Success -> {
                    log.info("chart.health_set")
                    val saved = statusesOf(listOf(answer.value), clinic.timeZone)[tooth]
                    saved?.let { chart.applyStatus(tooth, it) }
                    mutableHealth.update { it.copy(saving = false) }
                }

                is Outcome.Failure -> {
                    healthFailed(tooth, before, answer.error)
                }
            }
        }
    }

    /** Takes the doctor's health off [tooth]; it shows what its findings suggest again. */
    fun clear(tooth: Int) {
        if (mutableHealth.value.saving) return
        val before = chart.statusOf(tooth) ?: return
        chart.applyStatus(tooth, null)
        mutableHealth.value = HealthSaveState(saving = true)
        scope.launch {
            when (val answer = clinic.api.clearToothStatus(chart.patientId, tooth)) {
                is Outcome.Success -> {
                    log.info("chart.health_cleared")
                    mutableHealth.value = HealthSaveState()
                }

                is Outcome.Failure -> {
                    healthFailed(tooth, before, answer.error)
                }
            }
        }
    }

    fun dismissError() = mutableHealth.update { it.copy(error = null) }

    /** The sheet opened: a fresh note to write (the past ones are the tooth's notes). */
    fun open() {
        if (mutableHealth.value.listening != null) return
        mutableHealth.update { it.copy(error = null, note = "", live = null) }
    }

    /** The note being written; it saves when the sheet closes. */
    fun editNote(text: String) = mutableHealth.update { it.copy(note = text.take(MAX_HEALTH_NOTE)) }

    /** Takes the note out (into the Add treatment form), leaving the box empty. */
    fun takeNote(): String = mutableHealth.value.note.also { editNote("") }

    /** Dictates into the tooth note in [language]; the words join the note. */
    fun dictate(language: DictationLanguage) {
        if (mutableHealth.value.listening != null) return
        listenJob?.cancel()
        listenJob =
            scope.launch {
                dictation.events.collect { event ->
                    when (event) {
                        is DictationEvent.Partial -> {
                            mutableHealth.update { it.copy(live = event.text) }
                        }

                        is DictationEvent.Final -> {
                            mutableHealth.update { it.copy(note = joined(it.note, event.text), live = null) }
                        }

                        is DictationEvent.Failed, DictationEvent.Ended -> {
                            if (event is DictationEvent.Failed) {
                                log.warn("chart.note_dictation_failed") { code("reason", event.reason.name) }
                            }
                            mutableHealth.update {
                                it.copy(note = joined(it.note, it.live.orEmpty()), live = null, listening = null)
                            }
                            listenJob?.cancel()
                        }
                    }
                }
            }
        mutableHealth.update { it.copy(listening = language, error = null) }
        dictation.start(language)
    }

    fun stopDictation() = dictation.stop()

    private fun joined(
        note: String,
        more: String,
    ): String = listOf(note.trim(), more.trim()).filter { it.isNotEmpty() }.joinToString(" ").take(MAX_HEALTH_NOTE)

    private fun healthFailed(
        tooth: Int,
        before: ToothStatusView?,
        error: com.sakalya.mobile.core.ApiError,
    ) {
        log.warn("chart.health_failed") { code("error", error.code.value) }
        chart.applyStatus(tooth, before)
        mutableHealth.update { it.copy(saving = false, error = ScreenError.of(error)) }
    }

    private companion object {
        const val MAX_HEALTH_NOTE = 500
    }
}
