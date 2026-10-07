package com.aarogyam.staff.notes

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.NoteSections
import com.aarogyam.staff.api.model.PatientNotes
import com.aarogyam.staff.api.model.SummaryNote
import com.aarogyam.staff.api.model.VisitNote
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.moment
import com.aarogyam.staff.richtext.RichText
import com.aarogyam.staff.richtext.RichTextProblem
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The patient-level summary note, in the stored Markdown subset. */
data class SummaryView(
    val body: String,
    /** The version the API sent; the editor sends it back so a change made meanwhile is refused. */
    val version: Long,
    val updatedAt: ClinicMoment?,
    val updatedBy: String?,
)

enum class NoteStatus { Draft, Signed, Conflict, EnteredInError, Unknown }

/** The four SOAP sections a visit note can hold. */
enum class NoteSection { Subjective, Objective, Assessment, Plan }

data class NoteSectionView(
    val section: NoteSection,
    /** Markdown subset. */
    val text: String,
)

data class VisitNoteView(
    val id: String,
    val visitId: String,
    /** `V-318`. */
    val visitNumber: String,
    /** `soap`, `progress` and so on; the UI words it. */
    val kind: String,
    val status: NoteStatus,
    /** Only the sections that have text. */
    val sections: List<NoteSectionView>,
    val author: String,
    val at: ClinicMoment?,
    val addendaCount: Int,
)

/** Why the summary couldn't be saved. */
sealed interface SaveProblem {
    /** The text leaves the Markdown subset; nothing was sent. */
    data class Format(
        val problem: RichTextProblem,
    ) : SaveProblem

    /** Someone saved the note after this editor opened (`412`). */
    data object Changed : SaveProblem

    data class Failed(
        val error: ScreenError,
    ) : SaveProblem
}

/** The summary note being edited. */
data class SummaryEditor(
    val text: String,
    /** The version the text started from; null when there was no note. */
    val startedFrom: Long?,
    val saving: Boolean = false,
    val problem: SaveProblem? = null,
) {
    /** What the API would refuse, known before sending. */
    val formatProblem: RichTextProblem? get() = RichText.problem(text)

    val canSave: Boolean get() = !saving && formatProblem == null
}

/** What the Notes tab draws. */
sealed interface PatientNotesState {
    data object Loading : PatientNotesState

    /** The role lacks `clinical.read`; nothing was requested. */
    data object NotAllowed : PatientNotesState

    data class Failed(
        val error: ScreenError,
    ) : PatientNotesState

    /** [visitNotes] newest first. [canEdit] tells whether the role may write the summary note. */
    data class Loaded(
        val summary: SummaryView?,
        val visitNotes: List<VisitNoteView>,
        val canEdit: Boolean,
        val editor: SummaryEditor? = null,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    ) : PatientNotesState
}

/**
 * A patient's summary note and visit notes: one request to load, one `PUT` to save the summary.
 * Visit notes are read here; drafts are edited, signed and amended inside the visit.
 */
class PatientNotesStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.patientnotes"),
) {
    private val mutableState = MutableStateFlow<PatientNotesState>(PatientNotesState.Loading)

    /** The current tab state. */
    val state: StateFlow<PatientNotesState> = mutableState.asStateFlow()

    init {
        if (CLINICAL_READ in clinic.permissions) refresh() else mutableState.value = PatientNotesState.NotAllowed
    }

    /** Reloads, keeping what is on screen (and any text being edited) until the answer arrives. */
    fun refresh() {
        val current = mutableState.value
        when (current) {
            PatientNotesState.NotAllowed -> {
                return
            }

            is PatientNotesState.Loaded -> {
                if (current.refreshing) return
                mutableState.value = current.copy(refreshing = true, error = null)
            }

            else -> {
                mutableState.value = PatientNotesState.Loading
            }
        }
        scope.launch {
            when (val result = clinic.api.patientNotes(patientId)) {
                is Outcome.Success -> {
                    val editor = (mutableState.value as? PatientNotesState.Loaded)?.editor
                    mutableState.value = result.value.toState(editor)
                }

                is Outcome.Failure -> {
                    mutableState.value = loadFailed(current, result.error)
                }
            }
        }
    }

    private fun loadFailed(
        before: PatientNotesState,
        failure: ApiError,
    ): PatientNotesState {
        log.warn("patientnotes.load_failed") {
            id("patient", patientId)
            code("error", failure.code.value)
        }
        val error = ScreenError.of(failure)
        val now = mutableState.value
        return if (now is PatientNotesState.Loaded) {
            now.copy(refreshing = false, error = error)
        } else if (before is PatientNotesState.Loaded) {
            before.copy(refreshing = false, error = error)
        } else {
            PatientNotesState.Failed(error)
        }
    }

    /** Opens the editor on the current summary text (empty when there is none). */
    fun startEditing() {
        val current = mutableState.value as? PatientNotesState.Loaded ?: return
        if (!current.canEdit || current.editor != null) return
        mutableState.value =
            current.copy(editor = SummaryEditor(current.summary?.body.orEmpty(), current.summary?.version))
    }

    /** Replaces the text in the editor. */
    fun edit(text: String) {
        val current = mutableState.value as? PatientNotesState.Loaded ?: return
        val editor = current.editor ?: return
        if (editor.saving) return
        mutableState.value = current.copy(editor = editor.copy(text = text, problem = null))
    }

    /** Closes the editor without saving; after a refused save, reloads to show the newer text. */
    fun cancelEditing() {
        val current = mutableState.value as? PatientNotesState.Loaded ?: return
        val stale = current.editor?.problem == SaveProblem.Changed
        mutableState.value = current.copy(editor = null)
        if (stale) refresh()
    }

    /** Saves the edited text; refused locally when it leaves the Markdown subset. */
    fun save() {
        val current = mutableState.value as? PatientNotesState.Loaded ?: return
        val editor = current.editor ?: return
        if (!current.canEdit || editor.saving) return
        editor.formatProblem?.let {
            mutableState.value = current.copy(editor = editor.copy(problem = SaveProblem.Format(it)))
            return
        }
        mutableState.value = current.copy(editor = editor.copy(saving = true, problem = null))
        scope.launch {
            when (val result = clinic.api.saveSummaryNote(patientId, editor.text, editor.startedFrom)) {
                is Outcome.Success -> {
                    val now = mutableState.value as? PatientNotesState.Loaded ?: return@launch
                    mutableState.value = now.copy(summary = result.value.toView(clinic), editor = null, error = null)
                }

                is Outcome.Failure -> {
                    log.warn("patientnotes.save_failed") {
                        id("patient", patientId)
                        code("error", result.error.code.value)
                    }
                    val now = mutableState.value as? PatientNotesState.Loaded ?: return@launch
                    val problem =
                        if (result.error.kind == ApiErrorKind.PreconditionFailed) {
                            SaveProblem.Changed
                        } else {
                            SaveProblem.Failed(ScreenError.of(result.error))
                        }
                    mutableState.value = now.copy(editor = now.editor?.copy(saving = false, problem = problem))
                }
            }
        }
    }

    private fun PatientNotes.toState(editor: SummaryEditor?): PatientNotesState.Loaded =
        PatientNotesState.Loaded(
            summary = summary?.toView(clinic),
            visitNotes = visitNotes.map { it.toView(clinic) },
            canEdit = CLINICAL_WRITE in clinic.permissions,
            editor = editor,
        )

    private companion object {
        const val CLINICAL_READ = "clinical.read"
        const val CLINICAL_WRITE = "clinical.write"
    }
}

private fun SummaryNote.toView(clinic: ClinicContext) =
    SummaryView(body, rowVersion, moment(updatedAt, clinic.timeZone), updatedBy)

private fun VisitNote.toView(clinic: ClinicContext) =
    VisitNoteView(
        id = id,
        visitId = visitId,
        visitNumber = visitNumber,
        kind = kind,
        status = statusOf(status),
        sections = sections.toViews(),
        author = author.name,
        at = moment(signedAt ?: createdAt, clinic.timeZone),
        addendaCount = addendaCount.toInt(),
    )

private fun NoteSections.toViews(): List<NoteSectionView> =
    listOfNotNull(
        subjective?.takeIf { it.isNotBlank() }?.let { NoteSectionView(NoteSection.Subjective, it) },
        objective?.takeIf { it.isNotBlank() }?.let { NoteSectionView(NoteSection.Objective, it) },
        assessment?.takeIf { it.isNotBlank() }?.let { NoteSectionView(NoteSection.Assessment, it) },
        plan?.takeIf { it.isNotBlank() }?.let { NoteSectionView(NoteSection.Plan, it) },
    )

private fun statusOf(text: String): NoteStatus =
    when (text) {
        "draft" -> NoteStatus.Draft
        "signed" -> NoteStatus.Signed
        "conflict" -> NoteStatus.Conflict
        "entered_in_error" -> NoteStatus.EnteredInError
        else -> NoteStatus.Unknown
    }
