package com.aarogyam.staff.story

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.saveAttachmentPins
import com.aarogyam.staff.api.savePresentDiscussion
import com.aarogyam.staff.api.savePresentStyle
import com.aarogyam.staff.api.saveSmileShade
import com.aarogyam.staff.api.smileShade
import com.aarogyam.staff.api.uiPrefs
import com.aarogyam.staff.api.visit
import com.aarogyam.staff.api.visitMouth
import com.aarogyam.staff.api.visitPresent
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

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

    /** A save was refused because the visit is closed: tell the doctor it wasn't saved. */
    data object VisitClosed : PresentEvent
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
    private var present: JsonObject? = null
    private var style: String? = null
    private var patientId: String? = null
    private var shade: Int? = null
    private var extras = PresentExtras()

    /** The newest pins per X-ray, kept so a later redraw (dark mode) shows them before the server round trip. */
    private val pinEdits = mutableMapOf<String, JsonArray>()
    private val pinJobs = mutableMapOf<String, Job>()
    private var showJob: Job? = null
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

            is PageMessage.MakeDefault -> {
                makeDefault(message.style)
            }

            is PageMessage.SaveShade -> {
                saveShade(message.shade)
            }

            is PageMessage.SavePins -> {
                savePins(message.attachmentId, message.pins)
            }

            is PageMessage.SaveDiscussion -> {
                saveDiscussion(message.body)
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
            // The plan and the saved look are extras: without them the page opens on the painted map.
            val extras = async { clinic.api.visitPresent(visitId) }
            val prefs = async { clinic.api.uiPrefs() }
            // The visit names the patient, whose saved tooth colour the page opens on.
            val patientOf =
                async {
                    val patient = patientId ?: (clinic.api.visit(visitId) as? Outcome.Success)?.value?.visit?.patientId
                    patientId = patient
                    patient
                }
            val shadeOf =
                async { patientOf.await()?.let { (clinic.api.smileShade(it) as? Outcome.Success)?.value } }
            // X-rays, chart and discussions: each part that fails is simply left out.
            val extrasOf = async { patientOf.await()?.let { PresentExtras.fetch(clinic, visitId, it) } }
            val result = clinic.api.visitMouth(visitId)
            shadeOf.await()?.let { shade = it.shade }
            extrasOf.await()?.let { this@PresentStateHolder.extras = it }
            present = (extras.await() as? Outcome.Success)?.value ?: present
            style = (prefs.await() as? Outcome.Success)
                ?.value
                ?.get("present_style")
                ?.let {
                    (it as? JsonPrimitive)?.contentOrNull
                }?.takeIf { it in StoryBridge.STYLES } ?: style
            when (result) {
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
        val canSave = patientId != null && "clinical.write" in clinic.permissions
        mutableState.value = PresentState.Showing
        // The X-ray links are signed just before the page gets them (they last five minutes).
        showJob?.cancel()
        showJob =
            scope.launch {
                val xrays = extras.xrayOptions(clinic, pinEdits)
                val canSeePrices = "billing.read" in clinic.permissions
                scriptQueue.trySend(
                    StoryBridge.present(
                        snapshot,
                        dark,
                        style,
                        present,
                        shade,
                        canSave,
                        xrays = xrays,
                        chart = extras.chart,
                        discussions = extras.discussions,
                        plans = extras.plans,
                        canWrite = "clinical.write" in clinic.permissions,
                        canSeePrices = canSeePrices,
                    ),
                )
            }
    }

    /** Keeps only the latest pins per X-ray and sends them after [PIN_QUIET_MS] without another edit. */
    private fun savePins(
        attachmentId: String,
        pins: JsonArray,
    ) {
        if ("clinical.write" !in clinic.permissions) return
        pinEdits[attachmentId] = pins
        pinJobs[attachmentId]?.cancel()
        pinJobs[attachmentId] =
            scope.launch {
                delay(PIN_QUIET_MS)
                when (val saved = clinic.api.saveAttachmentPins(attachmentId, pins)) {
                    is Outcome.Success -> {
                        log.info("present.pins_saved") { id("attachment", attachmentId) }
                    }

                    is Outcome.Failure -> {
                        log.warn("present.pins_save_failed") { code("error", saved.error.code.value) }
                        if (saved.error.status == CONFLICT) eventQueue.trySend(PresentEvent.VisitClosed)
                    }
                }
            }
    }

    /** Saves one tooth's discussion; the page already shows "Saved", so a refusal is told by [PresentEvent.VisitClosed]. */
    private fun saveDiscussion(body: JsonObject) {
        if ("clinical.write" !in clinic.permissions) return
        scope.launch {
            when (val saved = clinic.api.savePresentDiscussion(visitId, body)) {
                is Outcome.Success -> {
                    log.info("present.discussion_saved") { id("visit", visitId) }
                }

                is Outcome.Failure -> {
                    log.warn("present.discussion_save_failed") { code("error", saved.error.code.value) }
                    if (saved.error.status == CONFLICT) eventQueue.trySend(PresentEvent.VisitClosed)
                }
            }
        }
    }

    /** Saves [chosen] as the doctor's own default look; a change without it lasts only this session. */
    private fun makeDefault(chosen: String) {
        style = chosen
        scope.launch {
            when (val saved = clinic.api.savePresentStyle(chosen)) {
                is Outcome.Success -> log.info("present.style_saved") { code("style", chosen) }
                is Outcome.Failure -> log.warn("present.style_save_failed") { code("error", saved.error.code.value) }
            }
        }
    }

    /** Saves [chosen] as the patient's tooth colour; the page keeps showing it either way. */
    private fun saveShade(chosen: Int) {
        val patient = patientId ?: return
        if ("clinical.write" !in clinic.permissions) return
        shade = chosen
        scope.launch {
            when (val saved = clinic.api.saveSmileShade(patient, chosen)) {
                is Outcome.Success -> log.info("present.shade_saved") { id("visit", visitId) }
                is Outcome.Failure -> log.warn("present.shade_save_failed") { code("error", saved.error.code.value) }
            }
        }
    }

    private companion object {
        const val PIN_QUIET_MS = 800L
        const val CONFLICT = 409
    }
}
