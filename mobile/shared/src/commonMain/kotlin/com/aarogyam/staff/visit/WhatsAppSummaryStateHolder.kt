package com.aarogyam.staff.visit

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.VisitPatientMessage
import com.aarogyam.staff.api.prepareVisitPatientMessage
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import io.ktor.http.encodeURLParameter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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

    /** Whether the Done screen shows the button at all. */
    val visible: Boolean = canSendSummary(clinic.permissions)

    /**
     * Asks the server for the message; null when it refused or failed (the state says why). A tap
     * while one is being prepared does nothing.
     */
    suspend fun prepareNow(): WhatsAppHandoff? {
        if (!visible || mutableState.value == WhatsAppSummaryState.Preparing) return null
        mutableState.value = WhatsAppSummaryState.Preparing
        return when (val answer = clinic.api.prepareVisitPatientMessage(visitId)) {
            is Outcome.Success -> {
                log.info("visit.summary_prepared") { id("visit", visitId) }
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

    private companion object {
        val REFUSALS =
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
