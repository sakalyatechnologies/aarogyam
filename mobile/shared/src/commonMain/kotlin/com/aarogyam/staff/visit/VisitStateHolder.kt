package com.aarogyam.staff.visit

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.CloseVisit
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
import com.aarogyam.staff.outbox.Queued
import com.aarogyam.staff.outbox.WriteQueue
import com.aarogyam.staff.outbox.shouldQueue
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
    /** Saves writes for later when offline; null keeps every write online-only. */
    private val writes: WriteQueue? = null,
) {
    private val mutableState = MutableStateFlow<VisitState>(VisitState.Starting)
    val state: StateFlow<VisitState> = mutableState.asStateFlow()
    private val noteClientId = IdempotencyKey.generate().toString()
    private var noteId: String? = null
    private var rowVersion: Long = 0
    private var nextBullet = 1
    private var saveJob: Job? = null
    private var listenJob: Job? = null

    // Once any note write went through the outbox, the rest do too: its row version is the sender's to know.
    private var noteViaQueue = false
    private val noteEntryIds = mutableSetOf<String>()
    private var closeEntryId: String? = null

    init {
        if (CLINICAL_WRITE in
            clinic.permissions
        ) {
            scope.launch { start() }
        } else {
            mutableState.value = VisitState.NotAllowed
        }
        writes?.let { w ->
            scope.launch { w.runner.ids.collect { syncFlags(it) } }
            scope.launch { w.runner.pendingByKey.collect { syncFlags(w.runner.ids.value) } }
        }
    }

    private fun syncFlags(ids: Set<String>) {
        val view = open() ?: return
        val unsent =
            writes
                ?.runner
                ?.pendingByKey
                ?.value
                ?.get(writes.visitKey(view.visitId)) ?: 0
        val note = noteEntryIds.any { it in ids }
        val close = closeEntryId?.let { it in ids } == true
        if (view.noteSync != note || view.closeSync != close || view.unsent != unsent) {
            update { it.copy(noteSync = note, closeSync = close, unsent = unsent) }
        }
    }

    private fun mustQueue(visitId: String): Boolean =
        writes != null && (!writes.online || noteViaQueue || writes.visitHasUnsent(visitId))

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
            if (mustQueue(view.visitId)) return@launch queueSign(view.visitId, id)
            when (val answer = clinic.api.signNote(id)) {
                is Outcome.Success -> {
                    update { it.copy(save = NoteSave.Signed) }
                }

                is Outcome.Failure -> {
                    if (answer.error.shouldQueue() &&
                        writes != null
                    ) {
                        queueSign(view.visitId, id)
                    } else {
                        failed("visit.sign_failed", answer.error)
                    }
                }
            }
        }
    }

    /** Saves any unsaved note, then closes the visit. */
    fun close() = closeWith(null, null, null)

    /**
     * Saves any unsaved note, then closes the visit; the one request also plans the follow-up on
     * [followUpOn] (`YYYY-MM-DD`, with [reason]) and starts the draft bill from [feePaise]. If the
     * server refuses any part (a past date, no permission) nothing happens and the visit stays open.
     */
    fun closeWith(
        followUpOn: String?,
        reason: String?,
        feePaise: Long?,
    ) {
        val view = open() ?: return
        if (view.closing || view.closed) return
        saveJob?.cancel()
        update { it.copy(closing = true, error = null, pendingFeePaise = feePaise ?: it.pendingFeePaise) }
        scope.launch {
            if (!view.closed) {
                if (view.save == NoteSave.Unsaved && !save()) return@launch update { it.copy(closing = false) }
                if (mustQueue(view.visitId)) return@launch queueClose(view, followUpOn, reason, feePaise)
                // The server plans the follow-up and starts the draft bill with the close (BE5).
                val answer = clinic.api.closeVisit(view.visitId, closeBody(followUpOn, reason, feePaise))
                if (answer is Outcome.Failure && writes != null && answer.error.shouldQueue()) {
                    return@launch queueClose(view, followUpOn, reason, feePaise)
                }
                if (answer is Outcome.Failure) {
                    failed("visit.close_failed", answer.error)
                    return@launch update { it.copy(closing = false) }
                }
                log.info("visit.closed") { id("visit", view.visitId) }
                update { it.copy(closed = true) }
            }
            update { it.copy(closing = false) }
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
        if (mustQueue(view.visitId)) return queueNote(view, sections)
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
                if (writes != null && answer.error.shouldQueue()) return queueNote(view, sections)
                failed("visit.note_failed", answer.error)
                update { it.copy(save = NoteSave.Failed) }
                false
            }
        }
    }

    /** Saves the note on the phone; the screen shows it as saved, with `noteSync` until it is sent. */
    private fun queueNote(
        view: VisitView,
        sections: com.aarogyam.staff.api.model.NoteSections,
    ): Boolean {
        val w = writes ?: return false
        val existing = noteId
        val queued =
            if (existing == null) {
                w.noteCreate(clinic.slug, view.visitId, NewNote(id = noteClientId, kind = SOAP, sections = sections))
            } else {
                w.noteEdit(clinic.slug, view.visitId, existing, NoteContent(kind = SOAP, sections = sections))
            }
        return when (queued) {
            is Queued.Saved -> {
                noteViaQueue = true
                noteId = existing ?: noteClientId
                noteEntryIds += queued.id
                update { it.copy(save = if (it.bullets == view.bullets) NoteSave.Saved else NoteSave.Unsaved) }
                syncFlags(w.runner.ids.value)
                true
            }

            is Queued.Refused -> {
                log.warn("visit.note_not_saved") { code("why", queued.why.name) }
                update { it.copy(save = NoteSave.Failed, error = ScreenError.Unknown) }
                false
            }
        }
    }

    private fun queueSign(
        visitId: String,
        id: String,
    ) {
        val w = writes ?: return
        when (val queued = w.noteSign(clinic.slug, visitId, id)) {
            is Queued.Saved -> {
                noteViaQueue = true
                noteEntryIds += queued.id
                update { it.copy(save = NoteSave.Signed) }
                syncFlags(w.runner.ids.value)
            }

            is Queued.Refused -> {
                update { it.copy(error = ScreenError.Unknown) }
            }
        }
    }

    private fun queueClose(
        view: VisitView,
        followUpOn: String?,
        reason: String?,
        feePaise: Long?,
    ) {
        val w = writes ?: return
        when (val queued = w.close(clinic.slug, view.visitId, patientId, followUpOn, reason, feePaise)) {
            is Queued.Saved -> {
                closeEntryId = queued.id
                update { it.copy(closing = false, closed = true) }
                syncFlags(w.runner.ids.value)
            }

            is Queued.Refused -> {
                update { it.copy(closing = false, error = ScreenError.Unknown) }
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
