package com.aarogyam.staff.story

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.visitMouth
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/** What the Show patient screen draws around its WebView. */
sealed interface PresentState {
    /** The snapshot or the page is still on its way. */
    data object Loading : PresentState

    /** The page shows the mouth. */
    data object Showing : PresentState

    data class Failed(
        val error: ScreenError,
    ) : PresentState

    /** The app's story bundle speaks a bridge version this build does not know. */
    data object Unsupported : PresentState
}

/** What the page asks the screen to do. */
sealed interface PresentEvent {
    /** The doctor held Exit: close the screen. */
    data object Exit : PresentEvent

    /** "Add depth" on [tooth]: open its decay depth chips. */
    data class AddDepth(
        val tooth: Int,
    ) : PresentEvent
}

/**
 * Show patient on the phone (design §1.12, P3b): the visit's server-built mouth snapshot
 * (`GET /visits/{id}/mouth`) handed raw to the story WebView, which draws the same mouth view as
 * the web. The screen evaluates each of [scripts] on its WebView, passes every page message to
 * [onPageMessage], and follows [events].
 */
class PresentStateHolder(
    private val clinic: ClinicContext,
    private val visitId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.present"),
) {
    private val mutableState = MutableStateFlow<PresentState>(PresentState.Loading)
    val state: StateFlow<PresentState> = mutableState.asStateFlow()

    private val scriptQueue = Channel<String>(Channel.UNLIMITED)

    /** JavaScript for the WebView, in order. */
    val scripts: Flow<String> = scriptQueue.receiveAsFlow()

    private val eventQueue = Channel<PresentEvent>(Channel.UNLIMITED)
    val events: Flow<PresentEvent> = eventQueue.receiveAsFlow()

    private var mouth: JsonObject? = null
    private var pageReady = false
    private var dark = false
    private var loading = false

    init {
        load()
    }

    /** One message from the page, as the JSON text it posted. */
    fun onPageMessage(text: String) {
        when (val message = StoryBridge.parse(text)) {
            is PageMessage.Ready -> {
                if (message.bundleVersion !in StoryBridge.SUPPORTED_VERSIONS) {
                    log.warn("present.bundle_unsupported") { code("version", message.bundleVersion.toString()) }
                    mutableState.value = PresentState.Unsupported
                    return
                }
                pageReady = true
                show()
            }

            PageMessage.Exit -> {
                eventQueue.trySend(PresentEvent.Exit)
            }

            is PageMessage.AddDepth -> {
                eventQueue.trySend(PresentEvent.AddDepth(message.tooth))
            }

            // Video messages belong to the Done screen's render.
            else -> {}
        }
    }

    /** The phone's light or dark look; the page follows it. */
    fun setDark(dark: Boolean) {
        if (this.dark == dark) return
        this.dark = dark
        if (mutableState.value == PresentState.Showing) show()
    }

    /** Fetches the snapshot again (after a detail was saved, or from Try again). */
    fun refresh() = load()

    private fun load() {
        if (loading) return
        if ("clinical.read" !in clinic.permissions) {
            mutableState.value = PresentState.Failed(ScreenError.NotAllowed)
            return
        }
        loading = true
        if (mouth == null) mutableState.value = PresentState.Loading
        scope.launch {
            when (val result = clinic.api.visitMouth(visitId)) {
                is Outcome.Success -> {
                    log.info("present.mouth_loaded") { id("visit", visitId) }
                    mouth = result.value
                    loading = false
                    show()
                }

                is Outcome.Failure -> {
                    log.warn("present.mouth_failed") { code("error", result.error.code.value) }
                    loading = false
                    if (mouth == null) mutableState.value = PresentState.Failed(ScreenError.of(result.error))
                }
            }
        }
    }

    private fun show() {
        val snapshot = mouth ?: return
        if (!pageReady || mutableState.value == PresentState.Unsupported) return
        scriptQueue.trySend(StoryBridge.present(snapshot, dark))
        mutableState.value = PresentState.Showing
    }
}
