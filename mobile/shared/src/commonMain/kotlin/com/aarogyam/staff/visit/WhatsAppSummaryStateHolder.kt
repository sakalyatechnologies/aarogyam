package com.aarogyam.staff.visit

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.handOffVisitPatientMessage
import com.aarogyam.staff.api.messagePrefs
import com.aarogyam.staff.api.model.VisitPatientMessage
import com.aarogyam.staff.api.prepareVisitPatientMessage
import com.aarogyam.staff.api.previewVisitPatientMessage
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import io.ktor.http.encodeURLParameter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock
import kotlin.time.Instant

/** Why the server would not prepare the summary, or why the phone cannot hand it off. */
enum class SummaryRefusal {
    /** `visit_open`: finish the visit first. */
    VisitOpen,

    /** `no_phone`: the patient (or guardian) has no mobile number. */
    NoPhone,

    /** `no_consent`: the patient hasn't agreed to messages about their care. */
    NoConsent,

    /** `opted_out`: WhatsApp messages from the clinic are turned off. */
    OptedOut,

    /** This phone has no WhatsApp or WhatsApp Business. */
    NoWhatsApp,
}

/**
 * The message, ready for WhatsApp. It holds the clinical text, so it lives in memory only and its
 * [toString] never prints it.
 */
class WhatsAppHandoff internal constructor(
    /** The number in digits only, as WhatsApp links want it. */
    val phoneDigits: String,
    val text: String,
) {
    /** Android: `wa.me` resolved inside the device by the WhatsApp package, so no web hop. */
    val waMeLink: String get() = "https://wa.me/$phoneDigits?text=${text.encodeURLParameter()}"

    /** iOS: the app's own scheme. */
    val appLink: String get() = "whatsapp://send?phone=$phoneDigits&text=${text.encodeURLParameter()}"

    override fun toString(): String = "WhatsAppHandoff(redacted)"
}

/**
 * One tick on the Done screen (spec 1.6), in the web's order. The server also knows `video`, which
 * comes with the video.
 */
enum class MessageSection(
    val wire: String,
) {
    Done("done"),
    Detail("detail"),
    Found("found"),
    Plan("plan"),
    Medicines("medicines"),
    Care("care"),
    Offer("offer"),
}

/** Every section the server knows, in its order: a toggle keeps them in it. */
private val ALL_SECTIONS = MessageSection.entries.map { it.wire } + "video"

/** One run of the preview: a stand-in for the link or PIN is drawn grey. */
data class PreviewPart(
    val text: String,
    val standIn: Boolean,
)

/** The preview's stand-ins: `/shared/` and 43 × `x`, and the PIN `XXXXXX`, as long as real ones. */
private val STAND_IN = Regex("""https?://\S*/shared/x{43}|XXXXXX""")

/** Splits the preview so the stand-in link and PIN can be greyed out. */
fun previewParts(text: String): List<PreviewPart> {
    val parts = mutableListOf<PreviewPart>()
    var at = 0
    for (match in STAND_IN.findAll(text)) {
        if (match.range.first > at) parts += PreviewPart(text.substring(at, match.range.first), false)
        parts += PreviewPart(match.value, true)
        at = match.range.last + 1
    }
    if (at < text.length) parts += PreviewPart(text.substring(at), false)
    return parts
}

/**
 * The ticks and their live preview. [ticked] is null until the doctor's defaults load; Send then
 * asks for every section and saves nothing. The preview mints nothing and lives in memory only.
 */
data class MessageTicks(
    val ticked: List<String>? = null,
    val preview: String? = null,
) {
    fun isOn(section: MessageSection): Boolean = ticked?.contains(section.wire) == true

    val previewParts: List<PreviewPart> get() = preview?.let(::previewParts).orEmpty()
}

/** What "Send on WhatsApp" on the Done screen draws. */
sealed interface WhatsAppSummaryState {
    data object Idle : WhatsAppSummaryState

    data object Preparing : WhatsAppSummaryState

    /**
     * Prepared, not sent: the doctor presses Send in WhatsApp, which we can't see. Times are minutes
     * of the clinic's day.
     */
    class Prepared(
        val handoff: WhatsAppHandoff,
        val preparedMinute: Int,
        val forGuardian: Boolean,
        /** When the automatic summary also went, if it did. */
        val autoSentMinute: Int?,
    ) : WhatsAppSummaryState

    data class Refused(
        val reason: SummaryRefusal,
    ) : WhatsAppSummaryState

    data class Failed(
        val error: ScreenError,
    ) : WhatsAppSummaryState
}

/** Only with both keys; the server checks the same. */
fun canSendSummary(permissions: Set<String>): Boolean =
    "clinical.read" in permissions && "patients.contact" in permissions

/**
 * "Send on WhatsApp" (visit story C2–C3): `POST /visits/{id}/patient-message` builds the patient's
 * summary, and the doctor sends it from their own WhatsApp. The answer is never stored, queued,
 * retried or logged; only the event and the visit id are.
 */
class WhatsAppSummaryStateHolder(
    private val clinic: ClinicContext,
    private val visitId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.whatsapp"),
    private val now: () -> Instant = { Clock.System.now() },
) {
    private val mutableState = MutableStateFlow<WhatsAppSummaryState>(WhatsAppSummaryState.Idle)
    val state: StateFlow<WhatsAppSummaryState> = mutableState.asStateFlow()

    private val mutableTicks = MutableStateFlow(MessageTicks())
    val ticks: StateFlow<MessageTicks> = mutableTicks.asStateFlow()

    /** Whether the Done screen shows the button at all. */
    val visible: Boolean = canSendSummary(clinic.permissions)

    private var previewWanted = false
    private var previewJob: Job? = null
    private var counted = false

    init {
        if (visible) scope.launch { loadDefaults() }
    }

    private suspend fun loadDefaults() {
        when (val prefs = clinic.api.messagePrefs()) {
            is Outcome.Success -> {
                mutableTicks.update { if (it.ticked == null) it.copy(ticked = prefs.value.sections) else it }
                if (previewWanted) schedulePreview(now = true)
            }

            // Without defaults the ticks stay hidden and Send asks for every section.
            is Outcome.Failure -> {
                log.warn("visit.message_prefs_failed") { code("error", prefs.error.code.value) }
            }
        }
    }

    /** The ticks are on screen: keep their preview fresh. */
    fun showPreview() {
        if (previewWanted) return
        previewWanted = true
        schedulePreview(now = true)
    }

    /** Ticks or unticks [section]; nothing is saved until Send. */
    fun toggle(
        section: MessageSection,
        on: Boolean,
    ) {
        val ticked = mutableTicks.value.ticked ?: return
        val next = ALL_SECTIONS.filter { if (it == section.wire) on else it in ticked }
        mutableTicks.update { it.copy(ticked = next) }
        schedulePreview(now = false)
    }

    private fun schedulePreview(now: Boolean) {
        if (!previewWanted) return
        val sections = mutableTicks.value.ticked ?: return
        previewJob?.cancel()
        previewJob =
            scope.launch {
                if (!now) delay(PREVIEW_DEBOUNCE_MS)
                when (val answer = clinic.api.previewVisitPatientMessage(visitId, sections)) {
                    is Outcome.Success -> {
                        mutableTicks.update { if (it.ticked == sections) it.copy(preview = answer.value.text) else it }
                    }

                    // The earlier preview stays; Send still works.
                    is Outcome.Failure -> {
                        log.warn("visit.summary_preview_failed") { code("error", answer.error.code.value) }
                    }
                }
            }
    }

    /**
     * WhatsApp took the prepared message: counted once per prepared message, as "handed to
     * WhatsApp", never "sent". Fire-and-forget: a failure never blocks the doctor.
     */
    fun handedOff() {
        if (counted || mutableState.value !is WhatsAppSummaryState.Prepared) return
        counted = true
        scope.launch {
            val answer = clinic.api.handOffVisitPatientMessage(visitId, TEMPLATE_VERSION)
            if (answer is Outcome.Failure) {
                log.warn(
                    "visit.summary_handoff_failed",
                ) { code("error", answer.error.code.value) }
            }
        }
    }

    /**
     * Asks the server for the message; null when it refused or failed (the state says why). A tap
     * while one is being prepared does nothing.
     */
    suspend fun prepareNow(): WhatsAppHandoff? {
        if (!visible || mutableState.value == WhatsAppSummaryState.Preparing) return null
        mutableState.value = WhatsAppSummaryState.Preparing
        return when (val answer = clinic.api.prepareVisitPatientMessage(visitId, mutableTicks.value.ticked)) {
            is Outcome.Success -> {
                log.info("visit.summary_prepared") { id("visit", visitId) }
                counted = false
                val prepared = prepared(answer.value)
                mutableState.value = prepared
                prepared.handoff
            }

            is Outcome.Failure -> {
                val code = answer.error.code.value
                log.warn("visit.summary_refused") { code("error", code) }
                val refusal = REFUSALS[code]
                mutableState.value =
                    if (refusal != null && answer.error.kind == ApiErrorKind.Conflict) {
                        WhatsAppSummaryState.Refused(refusal)
                    } else {
                        WhatsAppSummaryState.Failed(ScreenError.of(answer.error))
                    }
                null
            }
        }
    }

    /** For a caller without a coroutine: prepares, then hands the message to [open]. */
    fun prepare(open: (WhatsAppHandoff) -> Unit) {
        scope.launch { prepareNow()?.let(open) }
    }

    /** The phone has no WhatsApp: say so, and ask the server for nothing. */
    fun whatsAppMissing() {
        mutableState.value = WhatsAppSummaryState.Refused(SummaryRefusal.NoWhatsApp)
    }

    private fun prepared(message: VisitPatientMessage): WhatsAppSummaryState.Prepared {
        val zone = clinic.timeZone
        return WhatsAppSummaryState.Prepared(
            handoff = WhatsAppHandoff(message.phoneE164.filter(Char::isDigit), message.text),
            preparedMinute = now().minuteOfDay(zone),
            forGuardian = message.recipient == "guardian",
            autoSentMinute = message.autoSentAt?.let(::parseInstant)?.minuteOfDay(zone),
        )
    }

    companion object {
        /** Sent with each hand-off, so a later trust ramp knows which wording the count is about. */
        const val TEMPLATE_VERSION = "visit-message-v2"

        /** The live preview waits for the doctor to stop tapping. */
        const val PREVIEW_DEBOUNCE_MS = 400L

        private val REFUSALS =
            mapOf(
                "visit_open" to SummaryRefusal.VisitOpen,
                "no_phone" to SummaryRefusal.NoPhone,
                "no_consent" to SummaryRefusal.NoConsent,
                "opted_out" to SummaryRefusal.OptedOut,
            )
    }
}

private fun Instant.minuteOfDay(zone: TimeZone): Int = toLocalDateTime(zone).time.let { it.hour * MINUTES + it.minute }

private const val MINUTES = 60
