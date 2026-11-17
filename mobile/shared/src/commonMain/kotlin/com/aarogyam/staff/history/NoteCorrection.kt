package com.aarogyam.staff.history

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.amendNote
import com.aarogyam.staff.api.model.NoteCorrection
import com.aarogyam.staff.api.model.NoteSections
import com.aarogyam.staff.api.noteVersions
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.moment
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The four parts of a SOAP note, in the order the sheet shows them. */
enum class NoteSection { Subjective, Objective, Assessment, Plan }

/** The correction sheet. The text is clinical and never logged. */
data class NoteCorrectionState(
    val subjective: String,
    val objective: String,
    val assessment: String,
    val plan: String,
    /** Whether the text differs from the note and is not all empty, so Sign correction can be pressed. */
    val canSave: Boolean = false,
    val saving: Boolean = false,
    /** Set once the server signed the correction; the sheet closes and the visit reloads. */
    val saved: Boolean = false,
    /** Someone corrected this note meanwhile: reload the visit and correct the latest version. */
    val stale: Boolean = false,
    val error: ScreenError? = null,
) {
    fun text(section: NoteSection): String =
        when (section) {
            NoteSection.Subjective -> subjective
            NoteSection.Objective -> objective
            NoteSection.Assessment -> assessment
            NoteSection.Plan -> plan
        }
}

/**
 * Corrects one note of a past visit with `POST /notes/{id}/amend`: the whole corrected text goes up
 * as a new note signed by this person, and the original stays in the record. The client id is
 * kept while the text is unchanged, so a retry after a lost answer returns the same correction.
 */
class NoteCorrectionStateHolder(
    private val clinic: ClinicContext,
    private val note: CorrectableNote,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.note_correction"),
) {
    private val original = listOf(note.subjective, note.objective, note.assessment, note.plan).map { it.trim() }
    private var clientId = IdempotencyKey.generate().toString()
    private val mutableState =
        MutableStateFlow(NoteCorrectionState(note.subjective, note.objective, note.assessment, note.plan))

    val state: StateFlow<NoteCorrectionState> = mutableState.asStateFlow()

    fun set(
        section: NoteSection,
        text: String,
    ) {
        val s = mutableState.value
        if (s.saving || s.saved) return
        val cut = text.take(MAX_SECTION)
        if (cut == s.text(section)) return
        clientId = IdempotencyKey.generate().toString()
        val next =
            when (section) {
                NoteSection.Subjective -> s.copy(subjective = cut)
                NoteSection.Objective -> s.copy(objective = cut)
                NoteSection.Assessment -> s.copy(assessment = cut)
                NoteSection.Plan -> s.copy(plan = cut)
            }
        mutableState.value = next.copy(canSave = savable(next), error = null)
    }

    fun save() {
        val s = mutableState.value
        if (!s.canSave || s.saving) return
        mutableState.update { it.copy(saving = true, error = null) }
        scope.launch {
            val body =
                NoteCorrection(
                    id = clientId,
                    sections =
                        NoteSections(
                            subjective = s.subjective.trim().ifEmpty { null },
                            objective = s.objective.trim().ifEmpty { null },
                            assessment = s.assessment.trim().ifEmpty { null },
                            plan = s.plan.trim().ifEmpty { null },
                        ),
                )
            when (val answer = clinic.api.amendNote(note.id, body)) {
                is Outcome.Success -> {
                    log.info("note.corrected") { id("note", note.id) }
                    mutableState.update { it.copy(saving = false, saved = true) }
                }

                is Outcome.Failure -> {
                    log.warn("note.correct_failed") { code("error", answer.error.code.value) }
                    val stale = answer.error.kind == ApiErrorKind.Conflict
                    mutableState.update {
                        it.copy(
                            saving = false,
                            stale = stale,
                            canSave = !stale && it.canSave,
                            error = if (stale) null else ScreenError.of(answer.error),
                        )
                    }
                }
            }
        }
    }

    private fun savable(s: NoteCorrectionState): Boolean {
        val texts = NoteSection.entries.map { s.text(it).trim() }
        return texts.any { it.isNotEmpty() } && texts != original
    }

    private companion object {
        /** The server takes up to 10,000 characters a section. */
        const val MAX_SECTION = 10_000
    }
}

/** One earlier version of a corrected note, as it was signed. */
data class NoteVersion(
    val author: String,
    val at: ClinicMoment?,
    val subjective: String?,
    val objective: String?,
    val assessment: String?,
    val plan: String?,
)

sealed interface NoteVersionsState {
    data object Loading : NoteVersionsState

    data class Loaded(
        val versions: List<NoteVersion>,
    ) : NoteVersionsState

    data class Failed(
        val error: ScreenError,
    ) : NoteVersionsState
}

/** The versions a correction replaced, newest first, from `GET /notes/{id}/versions`; reading them is recorded by the server. */
class NoteVersionsStateHolder(
    private val clinic: ClinicContext,
    private val noteId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.note_versions"),
) {
    private val mutableState = MutableStateFlow<NoteVersionsState>(NoteVersionsState.Loading)
    val state: StateFlow<NoteVersionsState> = mutableState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        mutableState.value = NoteVersionsState.Loading
        scope.launch {
            mutableState.value =
                when (val answer = clinic.api.noteVersions(noteId)) {
                    is Outcome.Success -> {
                        NoteVersionsState.Loaded(
                            answer.value.items.map {
                                val s = it.sections
                                NoteVersion(
                                    it.author.name,
                                    moment(it.createdAt, clinic.timeZone),
                                    s.subjective?.trim()?.ifEmpty { null },
                                    s.objective?.trim()?.ifEmpty { null },
                                    s.assessment?.trim()?.ifEmpty { null },
                                    s.plan?.trim()?.ifEmpty { null },
                                )
                            },
                        )
                    }

                    is Outcome.Failure -> {
                        log.warn("note_versions.load_failed") { code("error", answer.error.code.value) }
                        NoteVersionsState.Failed(ScreenError.of(answer.error))
                    }
                }
        }
    }
}
