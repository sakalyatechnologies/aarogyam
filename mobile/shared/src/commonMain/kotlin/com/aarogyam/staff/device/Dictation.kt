package com.aarogyam.staff.device

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

/** A language the clinic can dictate notes in, with its BCP 47 tag for the recogniser. */
enum class DictationLanguage(
    val tag: String,
) {
    English("en-IN"),
    Hindi("hi-IN"),
    Marathi("mr-IN"),
    ;

    companion object {
        /** The language for [tag], or null when it is not one we dictate in. */
        fun fromTag(tag: String?): DictationLanguage? = entries.firstOrNull { it.tag == tag }
    }
}

/** Whether speech can be recognised for a language on this device. */
enum class DictationAvailability {
    /** Recognised on the phone; no audio leaves it. */
    OnDevice,

    /** Only the platform's online recogniser can do it; the screen says so first. */
    NetworkOnly,

    /** No recogniser for this language. */
    Unavailable,
}

/** Why dictation stopped early. */
enum class DictationFailure {
    PermissionDenied,
    NotAvailable,
    Network,
    NoSpeech,
    Busy,
    Other,
}

/** What the recogniser reports while listening. Audio is never kept (decision 7). */
sealed interface DictationEvent {
    /** The words so far; replaced by the next partial or the final text. */
    data class Partial(
        val text: String,
    ) : DictationEvent

    /** A finished phrase. */
    data class Final(
        val text: String,
    ) : DictationEvent

    data class Failed(
        val reason: DictationFailure,
    ) : DictationEvent

    /** Listening stopped normally. */
    data object Ended : DictationEvent
}

/**
 * The platform speech recogniser (SpeechRecognizer on Android, SFSpeechRecognizer on iOS),
 * passed into the app graph. One session at a time.
 */
interface Dictation {
    /** Every event of every session, in order. */
    val events: Flow<DictationEvent>

    fun availability(language: DictationLanguage): DictationAvailability

    /** Starts listening in [language]; the permission prompt, if any, is the platform's. */
    fun start(language: DictationLanguage)

    /** Stops listening; the recogniser sends its last [DictationEvent.Final] and [DictationEvent.Ended]. */
    fun stop()

    /** No recogniser: the default until the app passes its own. */
    object None : Dictation {
        override val events: Flow<DictationEvent> = emptyFlow()

        override fun availability(language: DictationLanguage) = DictationAvailability.Unavailable

        override fun start(language: DictationLanguage) = Unit

        override fun stop() = Unit
    }
}
