package com.aarogyam.staff.device

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/** A scripted recogniser: tests call [say] and [finish] to drive it. */
class FakeDictation(
    private val support: Map<DictationLanguage, DictationAvailability> =
        DictationLanguage.entries.associateWith { DictationAvailability.OnDevice },
) : Dictation {
    private val flow = MutableSharedFlow<DictationEvent>(extraBufferCapacity = 64)
    override val events: SharedFlow<DictationEvent> = flow

    /** The language of the running session, or null when idle. */
    var listening: DictationLanguage? = null
        private set

    override fun availability(language: DictationLanguage) = support[language] ?: DictationAvailability.Unavailable

    override fun start(language: DictationLanguage) {
        listening = language
    }

    override fun stop() {
        listening = null
        flow.tryEmit(DictationEvent.Ended)
    }

    fun say(
        partial: String,
        final: String? = null,
    ) {
        flow.tryEmit(DictationEvent.Partial(partial))
        if (final != null) flow.tryEmit(DictationEvent.Final(final))
    }

    fun fail(reason: DictationFailure) {
        listening = null
        flow.tryEmit(DictationEvent.Failed(reason))
    }
}
