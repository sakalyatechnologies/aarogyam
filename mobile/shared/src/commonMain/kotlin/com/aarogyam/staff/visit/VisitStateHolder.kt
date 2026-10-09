package com.aarogyam.staff.visit

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.closeVisit
import com.aarogyam.staff.api.createNote
import com.aarogyam.staff.api.editNote
import com.aarogyam.staff.api.model.NewNote
import com.aarogyam.staff.api.model.NewVisit
import com.aarogyam.staff.api.model.Note
import com.aarogyam.staff.api.model.NoteContent
import com.aarogyam.staff.api.model.Visit
import com.aarogyam.staff.api.signNote
import com.aarogyam.staff.api.startVisit
import com.aarogyam.staff.api.startVisitFromQueue
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.device.Dictation
import com.aarogyam.staff.device.DictationEvent
import com.aarogyam.staff.device.DictationLanguage
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.time.Instant

/** Where the note stands on the server. */
enum class NoteSave { Empty, Unsaved, Saving, Saved, Signed, Failed }

/** The Visit screen's data. Clinical text is for the screen only, never for logs. */
data class VisitView(
    val visitId: String,
    val number: String,
    val startedAt: Instant?,
    val bullets: List<Bullet> = emptyList(),
    val save: NoteSave = NoteSave.Empty,
    /** Words the recogniser is still hearing; becomes a bullet when final. */
    val liveText: String? = null,
    val listening: DictationLanguage? = null,
    val closing: Boolean = false,
    val closed: Boolean = false,
    val error: ScreenError? = null,
)

sealed interface VisitState {
    data object Starting : VisitState

    /** The role lacks `clinical.write`. */
    data object NotAllowed : VisitState

    data class Failed(
        val error: ScreenError,
    ) : VisitState

    data class Open(
        val view: VisitView,
    ) : VisitState
}

/**
 * Start treatment and the Visit screen. Starts from the queue token when there is one
 * (`/queue/{id}/start-visit`), otherwise `POST /patients/{id}/visits`. Bullets become one SOAP
 * note: created once with a client id, then saved [SAVE_DELAY_MS] after the last change with its
 * row version, signed, and the visit closed.
 */
class VisitStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val tokenId: String?,
    private val appointmentId: String?,
    private val dictation: Dictation,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.visit"),
) {
    private val mutableState = MutableStateFlow<VisitState>(VisitState.Starting)
    val state: StateFlow<VisitState> = mutableState.asStateFlow()
    private val noteClientId = IdempotencyKey.generate().toString()
    private var noteId: String? = null
    private var rowVersion: Long = 0
    private var nextBullet = 1
    private var saveJob: Job? = null
    private var listenJob: Job? = null

    init {
        if (CLINICAL_WRITE in
            clinic.permissions
        ) {
            scope.launch { start() }
        } else {
            mutableState.value = VisitState.NotAllowed
        }
    }

    fun addBullet(
        kind: BulletKind,
        text: String,
    ) {
        if (text.isBlank()) return
        edit { it.copy(bullets = it.bullets + Bullet(nextBullet++, kind, text.trim())) }
    }

    fun editBullet(
        id: Int,
        text: String,
    ) = edit { v -> v.copy(bullets = v.bullets.map { if (it.id == id) it.copy(text = text) else it }) }

    fun retag(
        id: Int,
        kind: BulletKind,
    ) = edit { v -> v.copy(bullets = v.bullets.map { if (it.id == id) it.copy(kind = kind) else it }) }

    fun removeBullet(id: Int) = edit { v -> v.copy(bullets = v.bullets.filterNot { it.id == id }) }

    /** Starts dictation in [language]; each final phrase becomes a Dictated bullet. */
    fun listen(language: DictationLanguage) {
        val view = open() ?: return
        if (view.listening != null) return
        listenJob?.cancel()
        listenJob =
            scope.launch {
                dictation.events.collect { event ->
                    when (event) {
                        is DictationEvent.Partial -> {
                            update { it.copy(liveText = event.text) }
                        }

                        is DictationEvent.Final -> {
                            update { it.copy(liveText = null) }
                            addBullet(BulletKind.Dictated, event.text)
                        }

                        is DictationEvent.Failed -> {
                            log.warn("visit.dictation_failed") { code("reason", event.reason.name) }
                            update { it.copy(listening = null, liveText = null) }
                            listenJob?.cancel()
                        }

                        DictationEvent.Ended -> {
                            update { it.copy(listening = null, liveText = null) }
                            listenJob?.cancel()
                        }
                    }
                }
            }
        update { it.copy(listening = language) }
        dictation.start(language)
    }

    fun stopListening() = dictation.stop()

    /** Saves now, then signs the note. */
    fun sign() {
        val view = open() ?: return
        if (view.bullets.isEmpty() || view.save == NoteSave.Signed) return
        saveJob?.cancel()
        scope.launch {
            if (!save()) return@launch
            val id = noteId ?: return@launch
            when (val answer = clinic.api.signNote(id)) {
                is Outcome.Success -> update { it.copy(save = NoteSave.Signed) }
                is Outcome.Failure -> failed("visit.sign_failed", answer.error)
            }
        }
    }

    /** Saves any unsaved note, then closes the visit. */
    fun close() {
        val view = open() ?: return
        if (view.closing || view.closed) return
        saveJob?.cancel()
        update { it.copy(closing = true) }
        scope.launch {
            if (view.save == NoteSave.Unsaved && !save()) return@launch update { it.copy(closing = false) }
            when (val answer = clinic.api.closeVisit(view.visitId)) {
                is Outcome.Success -> {
                    log.info("visit.closed") { id("visit", view.visitId) }
                    update { it.copy(closing = false, closed = true) }
                }

                is Outcome.Failure -> {
                    failed("visit.close_failed", answer.error)
                    update { it.copy(closing = false) }
                }
            }
        }
    }

    private suspend fun start() {
        val answer =
            if (tokenId != null) {
                when (val started = clinic.api.startVisitFromQueue(tokenId)) {
                    is Outcome.Success -> Outcome.Success(started.value.visit)
                    is Outcome.Failure -> started
                }
            } else {
                clinic.api.startVisit(
                    patientId,
                    NewVisit(id = IdempotencyKey.generate().toString(), appointmentId = appointmentId),
                )
            }
        mutableState.value =
            when (answer) {
                is Outcome.Success -> {
                    log.info("visit.started") { id("visit", answer.value.id) }
                    VisitState.Open(answer.value.toView())
                }

                is Outcome.Failure -> {
                    log.warn("visit.start_failed") { code("error", answer.error.code.value) }
                    VisitState.Failed(ScreenError.of(answer.error))
                }
            }
    }

    /** Creates or edits the note with the bullets on screen; false when it failed. */
    private suspend fun save(): Boolean {
        val view = open() ?: return false
        update { it.copy(save = NoteSave.Saving) }
        val sections = sectionsOf(view.bullets)
        val id = noteId
        val answer =
            if (id == null) {
                clinic.api.createNote(view.visitId, NewNote(id = noteClientId, kind = SOAP, sections = sections))
            } else {
                clinic.api.editNote(id, rowVersion, NoteContent(kind = SOAP, sections = sections))
            }
        return when (answer) {
            is Outcome.Success -> {
                remember(answer.value)
                // A change made while saving keeps the note unsaved; the next save takes it.
                update { it.copy(save = if (it.bullets == view.bullets) NoteSave.Saved else NoteSave.Unsaved) }
                true
            }

            is Outcome.Failure -> {
                failed("visit.note_failed", answer.error)
                update { it.copy(save = NoteSave.Failed) }
                false
            }
        }
    }

    private fun remember(note: Note) {
        noteId = note.id
        rowVersion = note.rowVersion
    }

    private fun edit(change: (VisitView) -> VisitView) {
        if (open()?.let { it.save == NoteSave.Signed || it.closed } != false) return
        update { change(it).copy(save = NoteSave.Unsaved, error = null) }
        saveJob?.cancel()
        saveJob =
            scope.launch {
                delay(SAVE_DELAY_MS)
                if (open()?.save == NoteSave.Unsaved) save()
            }
    }

    private fun open(): VisitView? = (mutableState.value as? VisitState.Open)?.view

    private fun update(change: (VisitView) -> VisitView) =
        mutableState.update { s -> if (s is VisitState.Open) VisitState.Open(change(s.view)) else s }

    private fun failed(
        event: String,
        error: com.sakalya.mobile.core.ApiError,
    ) {
        log.warn(event) { code("error", error.code.value) }
        update { it.copy(error = ScreenError.of(error)) }
    }

    private fun Visit.toView() = VisitView(id, number, parseInstant(startedAt))

    companion object {
        /** How long after the last change the note is saved. */
        const val SAVE_DELAY_MS: Long = 800
        private const val CLINICAL_WRITE = "clinical.write"
        private const val SOAP = "soap"
    }
}
